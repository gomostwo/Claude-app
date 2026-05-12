from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.sql import func
from ..database import Base


class Position(Base):
    """Open position per (user, broker, mode, ticker). Updated on each fill."""
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    broker = Column(String, nullable=False)      # paper | webull
    mode = Column(String, nullable=False)        # paper | live
    ticker = Column(String, nullable=False)
    qty = Column(Float, nullable=False, default=0.0)
    avg_cost = Column(Float, nullable=False, default=0.0)
    opened_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "broker", "mode", "ticker", name="uq_position"),
        Index("ix_position_user", "user_id", "mode"),
    )


class Order(Base):
    """Submitted order — persisted whether accepted, filled, or rejected."""
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    client_order_id = Column(String, nullable=False, unique=True)  # idempotency
    broker = Column(String, nullable=False)
    mode = Column(String, nullable=False)
    ticker = Column(String, nullable=False)
    side = Column(String, nullable=False)        # buy | sell
    qty = Column(Float, nullable=False)
    type = Column(String, nullable=False)        # market | limit
    limit_price = Column(Float, nullable=True)
    status = Column(String, nullable=False)      # pending | filled | rejected | cancelled
    filled_qty = Column(Float, nullable=False, default=0.0)
    filled_avg_price = Column(Float, nullable=True)
    reason_rejected = Column(String, nullable=True)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    filled_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_order_user_status", "user_id", "status"),
    )


class DailyPnL(Base):
    """End-of-day P&L snapshot per (user, mode, date)."""
    __tablename__ = "daily_pnl"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    mode = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    starting_equity = Column(Float, nullable=False)
    ending_equity = Column(Float, nullable=False)
    realized_pnl = Column(Float, nullable=False, default=0.0)
    unrealized_pnl = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "mode", "date", name="uq_daily_pnl"),
    )


class RiskState(Base):
    """Per-(user, mode) risk state. Holds kill-switch + start-of-day equity."""
    __tablename__ = "risk_state"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    mode = Column(String, nullable=False)
    kill_switch_active = Column(Boolean, nullable=False, default=False)
    kill_switch_reason = Column(String, nullable=True)
    day_started_equity = Column(Float, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "mode", name="uq_risk_state"),
    )
