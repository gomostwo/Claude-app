from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class WatchlistItem(Base):
    __tablename__ = "watchlist"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    ticker = Column(String, nullable=False, index=True)
    company_name = Column(String, nullable=True)
    asset_type = Column(String, default="stock")  # stock / commodity
    added_at = Column(DateTime(timezone=True), server_default=func.now())

    # Alert thresholds
    alert_price_above = Column(Float, nullable=True)
    alert_price_below = Column(Float, nullable=True)
    alert_rsi_overbought = Column(Boolean, default=False)
    alert_rsi_oversold = Column(Boolean, default=False)

    __table_args__ = (UniqueConstraint("user_id", "ticker", name="uq_user_ticker"),)

    # Relationships
    user = relationship("User", back_populates="watchlist")
