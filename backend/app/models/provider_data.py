from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Index
from sqlalchemy.sql import func
from ..database import Base


class ProviderQuote(Base):
    """Raw per-provider quote snapshot. One row per (provider, ticker, fetched_at)."""
    __tablename__ = "provider_quotes"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, nullable=False)        # yfinance | finnhub | twelvedata | fmp | alphavantage
    ticker = Column(String, nullable=False)
    asset_type = Column(String, nullable=False)      # stock | commodity
    price = Column(Float, nullable=True)
    change = Column(Float, nullable=True)
    change_percent = Column(Float, nullable=True)
    volume = Column(Float, nullable=True)
    aum = Column(Float, nullable=True)               # ETF assets-under-management snapshot, for flow signal
    raw_json = Column(Text, nullable=False)          # full provider payload for AI
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    error = Column(String, nullable=True)            # populated when fetch failed

    __table_args__ = (
        Index("ix_provider_quote_lookup", "ticker", "provider", "fetched_at"),
    )


class ProviderFundamental(Base):
    """Per-provider fundamental snapshot. Refreshed daily for stocks."""
    __tablename__ = "provider_fundamentals"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, nullable=False)
    ticker = Column(String, nullable=False)
    pe_ratio = Column(Float, nullable=True)
    forward_pe = Column(Float, nullable=True)
    eps = Column(Float, nullable=True)
    revenue_growth = Column(Float, nullable=True)
    profit_margin = Column(Float, nullable=True)
    debt_to_equity = Column(Float, nullable=True)
    dividend_yield = Column(Float, nullable=True)
    beta = Column(Float, nullable=True)
    market_cap = Column(Float, nullable=True)
    sector = Column(String, nullable=True)
    industry = Column(String, nullable=True)
    raw_json = Column(Text, nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    error = Column(String, nullable=True)

    __table_args__ = (
        Index("ix_provider_fund_lookup", "ticker", "provider", "fetched_at"),
    )
