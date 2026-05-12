"""PaperBroker — in-memory + DB-persisted simulated broker.

Order flow:
  1. Build OrderRequest from caller input + generate client_order_id if absent
  2. Run risk_manager.evaluate() — reject on failure (persist rejection)
  3. Fetch latest quote from ProviderQuote (newest price)
  4. Compute fill_price = last_price * (1 ± slippage_bps/10000), side-adjusted
  5. Update Position table (UPSERT) and Order row (filled)
  6. Return OrderResult

The PaperBroker shares its DB schema (Position, Order, DailyPnL, RiskState)
with future live brokers — fields `broker` and `mode` distinguish them.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session

from ...config import settings
from ...models import Order, Position, RiskState
from ..risk_manager import evaluate as risk_evaluate
from .base import (
    BrokerAdapter,
    OrderRequest,
    OrderResult,
    AccountSnapshot,
    PositionSnapshot,
)


def _mark_price(db: Session, ticker: str) -> Optional[float]:
    from ...models import ProviderQuote
    row = (
        db.query(ProviderQuote)
        .filter(ProviderQuote.ticker == ticker, ProviderQuote.price.isnot(None))
        .order_by(ProviderQuote.fetched_at.desc())
        .first()
    )
    return row.price if row else None


class PaperBroker:
    name = "paper"

    def __init__(self, db: Session):
        self.db = db

    def enabled(self) -> bool:
        return settings.paper_trading_enabled

    def supports_live(self) -> bool:
        return False

    # ── State helpers ──────────────────────────────────────────────────────

    def _list_positions_orm(self, user_id: int) -> List[Position]:
        return (
            self.db.query(Position)
            .filter(
                Position.user_id == user_id,
                Position.broker == self.name,
                Position.mode == "paper",
                Position.qty != 0,
            )
            .all()
        )

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

    def _cash(self, user_id: int) -> float:
        """Cash = starting_cash - sum(buy notional) + sum(sell proceeds)."""
        cash = settings.paper_starting_cash
        orders = (
            self.db.query(Order)
            .filter(
                Order.user_id == user_id,
                Order.broker == self.name,
                Order.status == "filled",
            )
            .all()
        )
        for o in orders:
            if o.filled_avg_price is None:
                continue
            notional = o.filled_qty * o.filled_avg_price
            cash += -notional if o.side == "buy" else notional
        return cash

    # ── Public API ─────────────────────────────────────────────────────────

    def get_account(self, user_id: int) -> AccountSnapshot:
        positions = self._list_positions_orm(user_id)
        cash = self._cash(user_id)
        position_value = 0.0
        for p in positions:
            mark = _mark_price(self.db, p.ticker)
            if mark is not None:
                position_value += p.qty * mark
        equity = cash + position_value
        return AccountSnapshot(
            cash=cash,
            equity=equity,
            buying_power=max(0.0, cash),
            mode="paper",
        )

    def list_positions(self, user_id: int) -> List[PositionSnapshot]:
        out: List[PositionSnapshot] = []
        for p in self._list_positions_orm(user_id):
            mark = _mark_price(self.db, p.ticker)
            mv = (p.qty * mark) if mark is not None else None
            out.append(PositionSnapshot(ticker=p.ticker, qty=p.qty, avg_cost=p.avg_cost, market_value=mv))
        return out

    def place_order(self, req: OrderRequest) -> OrderResult:
        # Auto-generate idempotency key if caller omitted
        if not req.client_order_id:
            req.client_order_id = f"paper-{uuid.uuid4().hex[:12]}"

        account = self.get_account(req.user_id)
        positions = self.list_positions(req.user_id)
        rs = self._risk_state(req.user_id)
        # Initialize day_started_equity on first order of the day
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

        # Approved → simulate fill
        mark = _mark_price(self.db, req.ticker)
        slippage = settings.slippage_bps / 10_000.0
        fill_price = mark * (1 + slippage) if req.side == "buy" else mark * (1 - slippage)

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
            status="filled",
            filled_qty=req.qty,
            filled_avg_price=fill_price,
            submitted_at=now,
            filled_at=now,
        )
        self.db.add(row)

        # Upsert position
        pos = (
            self.db.query(Position)
            .filter(
                Position.user_id == req.user_id,
                Position.broker == self.name,
                Position.mode == "paper",
                Position.ticker == req.ticker,
            )
            .first()
        )
        if pos is None:
            pos = Position(
                user_id=req.user_id,
                broker=self.name,
                mode="paper",
                ticker=req.ticker,
                qty=req.qty if req.side == "buy" else -req.qty,
                avg_cost=fill_price,
            )
            self.db.add(pos)
        else:
            new_qty = pos.qty + (req.qty if req.side == "buy" else -req.qty)
            if req.side == "buy" and pos.qty >= 0:
                # Weighted avg cost on add
                total_cost = pos.qty * pos.avg_cost + req.qty * fill_price
                pos.avg_cost = total_cost / new_qty if new_qty else 0.0
            pos.qty = new_qty
        self.db.commit()
        self.db.refresh(row)

        return OrderResult(
            id=row.id,
            client_order_id=row.client_order_id,
            status="filled",
            filled_qty=row.filled_qty,
            filled_avg_price=row.filled_avg_price,
            submitted_at=row.submitted_at,
            filled_at=row.filled_at,
        )

    def cancel_order(self, user_id: int, broker_order_id: str) -> bool:
        # Paper broker fills instantly; nothing to cancel.
        return False
