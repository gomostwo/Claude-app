"""yfinance adapter — always enabled, no API key required."""
import yfinance as yf
from typing import Optional

name = "yfinance"


def enabled() -> bool:
    return True


def fetch_quote(ticker: str) -> Optional[dict]:
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
    except Exception:
        return None
    if not info:
        return None

    price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("ask")
    prev = info.get("regularMarketPreviousClose") or info.get("previousClose")
    change = round(price - prev, 4) if (price and prev) else None
    change_pct = round((change / prev) * 100, 2) if (change and prev) else None

    return {
        "price": price,
        "change": change,
        "change_percent": change_pct,
        "volume": info.get("volume") or info.get("regularMarketVolume"),
        "raw": info,
    }


def fetch_fundamentals(ticker: str) -> Optional[dict]:
    try:
        info = yf.Ticker(ticker).info or {}
    except Exception:
        return None
    if not info:
        return None

    return {
        "pe_ratio": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "eps": info.get("trailingEps"),
        "revenue_growth": info.get("revenueGrowth"),
        "profit_margin": info.get("profitMargins"),
        "debt_to_equity": info.get("debtToEquity"),
        "dividend_yield": info.get("dividendYield"),
        "beta": info.get("beta"),
        "market_cap": info.get("marketCap"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "raw": info,
    }
