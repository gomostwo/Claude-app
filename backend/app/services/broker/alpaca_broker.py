"""Alpaca broker adapter — paper trading via Alpaca's official API.

Uses alpaca-py SDK pointing at the paper trading endpoint
(https://paper-api.alpaca.markets). `settings.alpaca_paper=True` is
enforced in __init__ — the live endpoint is never used from this class
until the user explicitly switches to live and a future PR wires it.

Order lifecycle for EOD submissions:
  1. Risk manager runs with account/positions from Alpaca paper account.
  2. Order submitted to Alpaca with TimeInForce.GTC so it fills at the
     next market open (09:30 ET) regardless of when after-hours we submit.
  3. A local Order row is persisted with status="submitted" and the
     Alpaca order UUID stored in broker_order_id for tracking.
  4. Fill confirmation polling is left for a future PR; for now the
     row is updated to "filled" on the next EOD scan's list_positions
     reconciliation (not yet implemented).
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session

from ...config import settings
from ...models import Order, RiskState
from ..risk_manager import evaluate as risk_evaluate
from .base import (
    BrokerAdapter,
    OrderRequest,
    OrderResult,
    AccountSnapshot,
    PositionSnapshot,
)


def _get_client():
    from alpaca.trading.client import TradingClient
    if not settings.alpaca_api_key or not settings.alpaca_api_secret:
        raise ValueError("ALPACA_API_KEY and ALPACA_API_SECRET must be set")
    return TradingClient(
        api_key=settings.alpaca_api_key,
        secret_key=settings.alpaca_api_secret,
        paper=settings.alpaca_paper,
    )


class AlpacaBroker:
    name = "alpaca"

    def __init__(self, db: Session):
        if not settings.alpaca_paper:
            raise PermissionError(
                "AlpacaBroker: settings.alpaca_paper=False is not allowed "
                "until live trading PR is merged."
            )
        self.db = db
        self._client = _get_client()

    def enabled(self) -> bool:
        return bool(settings.alpaca_api_key and settings.alpaca_api_secret)

    def supports_live(self) -> bool:
        return False  # paper only until live PR

    def _risk_state(self, user_id: int) -> RiskState:
        rs = (
            self.db.query(RiskState)
            .filter(RiskState.user_id == user_id, RiskState.mode == "paper")
            .first()
        )
        if rs is None:
            rs = RiskState(user_id=user_id, mode="paper", kill_switch_active=False)
            self.db.add(rs)
            self.db.commit()
            self.db.refresh(rs)
        return rs

    def get_account(self, user_id: int) -> AccountSnapshot:
        acct = self._client.get_account()
        return AccountSnapshot(
            cash=float(acct.cash),
            equity=float(acct.equity),
            buying_power=float(acct.buying_power),
            mode="paper",
        )

    def list_positions(self, user_id: int) -> List[PositionSnapshot]:
        positions = self._client.get_all_positions()
        return [
            PositionSnapshot(
                ticker=str(p.symbol),
                qty=float(p.qty),
                avg_cost=float(p.avg_entry_price),
                market_value=float(p.market_value) if p.market_value else None,
            )
            for p in positions
        ]

    def place_order(self, req: OrderRequest) -> OrderResult:
        from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest
        from alpaca.trading.enums import OrderSide, TimeInForce

        if not req.client_order_id:
            req.client_order_id = f"alpaca-{uuid.uuid4().hex[:12]}"

        account = self.get_account(req.user_id)
        positions = self.list_positions(req.user_id)
        rs = self._risk_state(req.user_id)
        if rs.day_started_equity is None:
            rs.day_started_equity = account.equity
            self.db.commit()

        decision = risk_evaluate(
            self.db,
            order=req,
            account=account,
            positions=positions,
            mode="paper",
            risk_state=rs,
        )

        now = datetime.now(timezone.utc)
        if not decision.approved:
            row = Order(
                user_id=req.user_id,
                client_order_id=req.client_order_id,
                broker=self.name,
                mode="paper",
                ticker=req.ticker,
                side=req.side,
                qty=req.qty,
                type=req.type,
                limit_price=req.limit_price,
                status="rejected",
                reason_rejected=decision.reason,
                submitted_at=now,
            )
            self.db.add(row)
            self.db.commit()
            self.db.refresh(row)
            return OrderResult(
                id=row.id,
                client_order_id=row.client_order_id,
                status="rejected",
                reason_rejected=decision.reason,
                submitted_at=now,
            )

        side = OrderSide.BUY if req.side == "buy" else OrderSide.SELL
        # GTC ensures EOD-submitted orders queue for next market open
        if req.type == "limit" and req.limit_price is not None:
            alpaca_req = LimitOrderRequest(
                symbol=req.ticker,
                qty=req.qty,
                side=side,
                time_in_force=TimeInForce.GTC,
                limit_price=req.limit_price,
            )
        else:
            alpaca_req = MarketOrderRequest(
                symbol=req.ticker,
                qty=req.qty,
                side=side,
                time_in_force=TimeInForce.GTC,
            )

        alpaca_order = self._client.submit_order(order_data=alpaca_req)

        row = Order(
            user_id=req.user_id,
            client_order_id=req.client_order_id,
            broker=self.name,
            mode="paper",
            ticker=req.ticker,
            side=req.side,
            qty=req.qty,
            type=req.type,
            limit_price=req.limit_price,
            status="submitted",
            submitted_at=now,
        )
        # Store Alpaca's UUID so we can reconcile fills later
        if hasattr(row, "broker_order_id"):
            row.broker_order_id = str(alpaca_order.id)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)

        return OrderResult(
            id=row.id,
            client_order_id=row.client_order_id,
            status="submitted",
            submitted_at=now,
        )

    def cancel_order(self, user_id: int, broker_order_id: str) -> bool:
        try:
            self._client.cancel_order_by_id(broker_order_id)
            return True
        except Exception:
            return False
