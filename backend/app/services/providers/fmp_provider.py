"""Financial Modeling Prep adapter — 250 req/day free."""
from typing import Optional
import httpx
from ...config import settings

name = "fmp"

BASE_URL = "https://financialmodelingprep.com/api/v3"


def enabled() -> bool:
    return bool(settings.fmp_api_key)


def _symbol(ticker: str) -> str:
    return ticker.replace("-", ".")


def _get(path: str, params: Optional[dict] = None) -> Optional[list]:
    if not settings.fmp_api_key:
        return None
    params = {**(params or {}), "apikey": settings.fmp_api_key}
    try:
        r = httpx.get(f"{BASE_URL}{path}", params=params, timeout=10.0)
        r.raise_for_status()
        data = r.json()
        return data if data else None
    except Exception:
        return None


def fetch_quote(ticker: str) -> Optional[dict]:
    sym = _symbol(ticker)
    data = _get(f"/quote/{sym}")
    if not data or not isinstance(data, list):
        return None
    q = data[0]
    return {
        "price": q.get("price"),
        "change": q.get("change"),
        "change_percent": q.get("changesPercentage"),
        "volume": q.get("volume"),
        "raw": q,
    }


def fetch_fundamentals(ticker: str) -> Optional[dict]:
    sym = _symbol(ticker)
    profile = _get(f"/profile/{sym}")
    ratios = _get(f"/ratios-ttm/{sym}")
    metrics = _get(f"/key-metrics-ttm/{sym}")
    if not profile and not ratios:
        return None
    p = (profile or [{}])[0] if profile else {}
    r = (ratios or [{}])[0] if ratios else {}
    m = (metrics or [{}])[0] if metrics else {}

    return {
        "pe_ratio": r.get("peRatioTTM") or p.get("pe"),
        "forward_pe": r.get("priceEarningsRatioTTM"),
        "eps": m.get("netIncomePerShareTTM") or p.get("eps"),
        "revenue_growth": r.get("revenueGrowth"),
        "profit_margin": r.get("netProfitMarginTTM"),
        "debt_to_equity": r.get("debtEquityRatioTTM"),
        "dividend_yield": r.get("dividendYielTTM") or r.get("dividendYieldTTM"),
        "beta": p.get("beta"),
        "market_cap": p.get("mktCap"),
        "sector": p.get("sector"),
        "industry": p.get("industry"),
        "raw": {"profile": p, "ratios": r, "metrics": m},
    }
