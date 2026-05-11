"""Alpha Vantage adapter — 25 req/day free (use sparingly)."""
from typing import Optional
import httpx
from ...config import settings

name = "alphavantage"

BASE_URL = "https://www.alphavantage.co/query"

COMMODITY_FUNCTIONS = {
    "GC=F": ("CURRENCY_EXCHANGE_RATE", {"from_currency": "XAU", "to_currency": "USD"}),
    "SI=F": ("CURRENCY_EXCHANGE_RATE", {"from_currency": "XAG", "to_currency": "USD"}),
    "CL=F": ("WTI", {"interval": "daily"}),
    "BZ=F": ("BRENT", {"interval": "daily"}),
    "NG=F": ("NATURAL_GAS", {"interval": "daily"}),
}


def enabled() -> bool:
    return bool(settings.alphavantage_api_key)


def _get(params: dict) -> Optional[dict]:
    if not settings.alphavantage_api_key:
        return None
    params = {**params, "apikey": settings.alphavantage_api_key}
    try:
        r = httpx.get(BASE_URL, params=params, timeout=10.0)
        r.raise_for_status()
        data = r.json()
        if "Note" in data or "Information" in data:  # rate-limited
            return None
        return data
    except Exception:
        return None


def fetch_quote(ticker: str) -> Optional[dict]:
    if ticker in COMMODITY_FUNCTIONS:
        func, extra = COMMODITY_FUNCTIONS[ticker]
        data = _get({"function": func, **extra})
        if not data:
            return None
        if func == "CURRENCY_EXCHANGE_RATE":
            rate = data.get("Realtime Currency Exchange Rate", {})
            try:
                price = float(rate.get("5. Exchange Rate"))
            except (TypeError, ValueError):
                return None
            return {"price": price, "change": None, "change_percent": None, "volume": None, "raw": data}
        # WTI/BRENT/NATURAL_GAS return time-series
        series = data.get("data") or []
        if not series:
            return None
        try:
            price = float(series[0].get("value"))
        except (TypeError, ValueError):
            return None
        return {"price": price, "change": None, "change_percent": None, "volume": None, "raw": data}

    sym = ticker.replace("-", ".")
    data = _get({"function": "GLOBAL_QUOTE", "symbol": sym})
    if not data:
        return None
    q = data.get("Global Quote", {})
    if not q:
        return None

    def _f(key):
        try:
            return float(q.get(key)) if q.get(key) not in (None, "") else None
        except (TypeError, ValueError):
            return None

    pct_str = q.get("10. change percent", "").replace("%", "")
    try:
        change_pct = float(pct_str) if pct_str else None
    except ValueError:
        change_pct = None

    return {
        "price": _f("05. price"),
        "change": _f("09. change"),
        "change_percent": change_pct,
        "volume": _f("06. volume"),
        "raw": q,
    }


def fetch_fundamentals(ticker: str) -> Optional[dict]:
    if ticker in COMMODITY_FUNCTIONS:
        return None
    sym = ticker.replace("-", ".")
    data = _get({"function": "OVERVIEW", "symbol": sym})
    if not data or not data.get("Symbol"):
        return None

    def _f(key):
        try:
            v = data.get(key)
            return float(v) if v not in (None, "None", "") else None
        except (TypeError, ValueError):
            return None

    return {
        "pe_ratio": _f("PERatio"),
        "forward_pe": _f("ForwardPE"),
        "eps": _f("EPS"),
        "revenue_growth": _f("QuarterlyRevenueGrowthYOY"),
        "profit_margin": _f("ProfitMargin"),
        "debt_to_equity": None,  # not provided directly
        "dividend_yield": _f("DividendYield"),
        "beta": _f("Beta"),
        "market_cap": _f("MarketCapitalization"),
        "sector": data.get("Sector"),
        "industry": data.get("Industry"),
        "raw": data,
    }
