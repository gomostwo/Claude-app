from typing import Optional
from .stock_data import get_stock_info, COMMODITY_TICKERS


def compute_fundamental_data(ticker: str) -> Optional[dict]:
    """Extract fundamental metrics from yfinance info. Returns None for commodities."""
    if ticker in COMMODITY_TICKERS:
        return None

    info = get_stock_info(ticker)
    if not info:
        return None

    def _safe(key) -> Optional[float]:
        val = info.get(key)
        if val is None or val == "N/A":
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    return {
        "ticker": ticker,
        "pe_ratio": _safe("trailingPE"),
        "forward_pe": _safe("forwardPE"),
        "eps": _safe("trailingEps"),
        "revenue_growth": _safe("revenueGrowth"),
        "profit_margin": _safe("profitMargins"),
        "debt_to_equity": _safe("debtToEquity"),
        "dividend_yield": _safe("dividendYield"),
        "beta": _safe("beta"),
        "fifty_two_week_high": _safe("fiftyTwoWeekHigh"),
        "fifty_two_week_low": _safe("fiftyTwoWeekLow"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
    }
