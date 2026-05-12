"""Deterministic risk manager — every order passes through `evaluate()`
before reaching a broker. Pure function: no I/O beyond the SQLAlchemy
session it's handed, no AI calls.

Invariants enforced (each one a hard rejection on failure):
  1. kill_switch_active == False
  2. notional <= equity * max_position_pct
  3. group exposure post-fill <= equity * correlation_cap
  4. daily P&L > -daily_loss_kill_pct * day_started_equity  (else trip kill switch)
  5. live_trading_enabled == True OR mode == "paper"
  6. ticker in COMMODITY_TICKERS (round-1 scope lock)
  7. qty > 0, client_order_id present + unique
  8. quote staleness < quote_max_staleness_seconds
  9. order type in {market, limit}; limit_price within ±5% of last price
"""
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Order, Position, RiskState, ProviderQuote
from .stock_data import COMMODITY_TICKERS, COMMODITY_GROUPS, commodity_group_for
from .broker.base import OrderRequest, AccountSnapshot, PositionSnapshot


@dataclass
class RiskDecision:
    approved: bool
    reason: str = ""


def _latest_price(db: Session, ticker: str) -> Optional[tuple[float, datetime]]:
    """Most recent multi-provider quote with a non-null price."""
    row = (
        db.query(ProviderQuote)
        .filter(ProviderQuote.ticker == ticker, ProviderQuote.price.isnot(None))
        .order_by(ProviderQuote.fetched_at.desc())
        .first()
    )
    if not row:
        return None
    return (row.price, row.fetched_at)


def evaluate(
    db: Session,
    *,
    order: OrderRequest,
    account: AccountSnapshot,
    positions: List[PositionSnapshot],
    mode: str,                                    # "paper" | "live"
    risk_state: Optional[RiskState] = None,
) -> RiskDecision:
    # 1. Kill switch
    if risk_state and risk_state.kill_switch_active:
        return RiskDecision(False, f"kill switch active: {risk_state.kill_switch_reason or 'unknown'}")

    # 6. Universe lock (round 1 only commodities)
    if order.ticker not in COMMODITY_TICKERS:
        return RiskDecision(False, f"ticker {order.ticker} not in commodity universe")

    # 7a. Quantity sanity
    if order.qty <= 0:
        return RiskDecision(False, f"qty must be > 0 (got {order.qty})")

    # 7b. Idempotency
    if not order.client_order_id:
        return RiskDecision(False, "client_order_id required for idempotency")
    existing = (
        db.query(Order)
        .filter(Order.client_order_id == order.client_order_id)
        .first()
    )
    if existing is not None:
        return RiskDecision(False, f"client_order_id already used (order #{existing.id})")

    # 9a. Order type
    if order.type not in ("market", "limit"):
        return RiskDecision(False, f"unsupported order type {order.type}")

    # 8 + 9b. Quote staleness + limit-price sanity
    quote = _latest_price(db, order.ticker)
    if not quote:
        return RiskDecision(False, "no recent quote available")
    last_price, fetched_at = quote
    age = datetime.now(timezone.utc) - fetched_at.replace(tzinfo=fetched_at.tzinfo or timezone.utc)
    if age > timedelta(seconds=settings.quote_max_staleness_seconds):
        return RiskDecision(False, f"quote stale ({int(age.total_seconds())}s)")
    if order.type == "limit":
        if order.limit_price is None:
            return RiskDecision(False, "limit order missing limit_price")
        if abs(order.limit_price - last_price) / last_price > 0.05:
            return RiskDecision(False, f"limit_price {order.limit_price} > 5% from market {last_price}")

    # 2. Position size cap
    notional = order.qty * (order.limit_price or last_price)
    if notional > account.equity * settings.max_position_pct:
        return RiskDecision(
            False,
            f"notional ${notional:,.2f} exceeds max position {settings.max_position_pct*100:.1f}% of equity ${account.equity:,.2f}",
        )

    # 3. Correlation cap — group exposure post-fill
    group = commodity_group_for(order.ticker)
    if group:
        group_members = COMMODITY_GROUPS[group]
        post_fill_qty = {p.ticker: p.qty for p in positions}
        delta = order.qty if order.side == "buy" else -order.qty
        post_fill_qty[order.ticker] = post_fill_qty.get(order.ticker, 0.0) + delta
        group_notional = 0.0
        for pos in positions:
            if pos.ticker in group_members and pos.ticker != order.ticker:
                price_row = _latest_price(db, pos.ticker)
                if price_row:
                    group_notional += pos.qty * price_row[0]
        group_notional += max(0.0, post_fill_qty[order.ticker]) * last_price
        if group_notional > account.equity * settings.correlation_cap:
            return RiskDecision(
                False,
                f"group '{group}' exposure ${group_notional:,.2f} exceeds cap {settings.correlation_cap*100:.1f}% of equity",
            )

    # 4. Daily-loss kill switch evaluation
    if risk_state and risk_state.day_started_equity:
        intraday_pnl = account.equity - risk_state.day_started_equity
        threshold = -settings.daily_loss_kill_pct * risk_state.day_started_equity
        if intraday_pnl < threshold:
            risk_state.kill_switch_active = True
            risk_state.kill_switch_reason = f"intraday P&L {intraday_pnl:,.2f} < {threshold:,.2f}"
            db.commit()
            return RiskDecision(False, f"kill switch tripped: {risk_state.kill_switch_reason}")

    # 5. Live trading flag (paper always allowed)
    if mode == "live" and not settings.live_trading_enabled:
        return RiskDecision(False, "live trading disabled (settings.live_trading_enabled=False)")

    return RiskDecision(True, "ok")
