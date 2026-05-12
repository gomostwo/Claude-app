"""Twelve Data adapter — 800 req/day, 8 req/min free."""
from typing import Optional
import httpx
from ...config import settings

name = "twelvedata"

BASE_URL = "https://api.twelvedata.com"


def enabled() -> bool:
    return bool(settings.twelvedata_api_key)


def _symbol(ticker: str) -> str:
    return ticker.replace("-", ".")


def _get(path: str, params: dict) -> Optional[dict]:
    if not settings.twelvedata_api_key:
        return None
    params = {**params, "apikey": settings.twelvedata_api_key}
    try:
        r = httpx.get(f"{BASE_URL}{path}", params=params, timeout=10.0)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict) and data.get("status") == "error":
            return None
        return data
    except Exception:
        return None


def fetch_quote(ticker: str) -> Optional[dict]:
    sym = _symbol(ticker)
    data = _get("/quote", {"symbol": sym})
    if not data or "close" not in data:
        return None

    def _f(key):
        v = data.get(key)
        try:
            return float(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None

    return {
        "price": _f("close"),
        "change": _f("change"),
        "change_percent": _f("percent_change"),
        "volume": _f("volume"),
        "raw": data,
    }


def fetch_fundamentals(ticker: str) -> Optional[dict]:
    sym = _symbol(ticker)
    stats = _get("/statistics", {"symbol": sym})
    profile = _get("/profile", {"symbol": sym})
    if not stats and not profile:
        return None

    s = (stats or {}).get("statistics", {}) if stats else {}
    valuation = s.get("valuations_metrics", {}) if isinstance(s, dict) else {}
    financials = s.get("financials", {}) if isinstance(s, dict) else {}
    income = financials.get("income_statement", {}) if isinstance(financials, dict) else {}
    div = s.get("dividends_and_splits", {}) if isinstance(s, dict) else {}
    stock_stats = s.get("stock_statistics", {}) if isinstance(s, dict) else {}

    def _f(d, key):
        v = (d or {}).get(key) if isinstance(d, dict) else None
        try:
            return float(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None

    return {
        "pe_ratio": _f(valuation, "trailing_pe"),
        "forward_pe": _f(valuation, "forward_pe"),
        "eps": _f(income, "diluted_eps_ttm"),
        "revenue_growth": _f(income, "quarterly_revenue_growth"),
        "profit_margin": _f(income, "profit_margin"),
        "debt_to_equity": _f(financials.get("balance_sheet", {}), "total_debt_to_equity_mrq") if isinstance(financials, dict) else None,
        "dividend_yield": _f(div, "forward_annual_dividend_yield"),
        "beta": _f(stock_stats, "beta"),
        "market_cap": _f(valuation, "market_capitalization"),
        "sector": (profile or {}).get("sector"),
        "industry": (profile or {}).get("industry"),
        "raw": {"statistics": stats, "profile": profile},
    }
