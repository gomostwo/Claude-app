"""Market data provider adapters.

Each provider module exposes:
    name: str
    enabled() -> bool
    fetch_quote(ticker: str) -> dict | None
    fetch_fundamentals(ticker: str) -> dict | None

Returned dicts use the unified shape:
    quote: {price, change, change_percent, volume, raw}
    fundamentals: {pe_ratio, forward_pe, eps, revenue_growth, profit_margin,
                   debt_to_equity, dividend_yield, beta, market_cap,
                   sector, industry, raw}
Commodities only return quotes; fundamentals may be None.
"""
from . import (
    yfinance_provider,
    finnhub_provider,
    twelvedata_provider,
    fmp_provider,
    alphavantage_provider,
    eia_provider,
    fred_provider,
    cftc_provider,
)

# Quote/fundamental providers — same shape, used by data_ingestion.ingest_ticker
ALL_PROVIDERS = [
    yfinance_provider,
    finnhub_provider,
    twelvedata_provider,
    fmp_provider,
    alphavantage_provider,
]

# Commodity-context providers — different return shapes, used by commodity_signals
COMMODITY_CONTEXT_PROVIDERS = [
    eia_provider,
    fred_provider,
    cftc_provider,
]


def enabled_providers():
    return [p for p in ALL_PROVIDERS if p.enabled()]


def enabled_commodity_providers():
    return [p for p in COMMODITY_CONTEXT_PROVIDERS if p.enabled()]
