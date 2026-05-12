"""Finnhub adapter — 60 req/min free tier."""
from typing import Optional
from ...config import settings

name = "finnhub"

_client = None


def _get_client():
    global _client
    if _client is None and settings.finnhub_api_key:
        import finnhub
        _client = finnhub.Client(api_key=settings.finnhub_api_key)
    return _client


def enabled() -> bool:
    return bool(settings.finnhub_api_key)


def _normalize_ticker(ticker: str) -> str:
    return ticker.replace("-", ".")


def fetch_quote(ticker: str) -> Optional[dict]:
    client = _get_client()
    sym = _normalize_ticker(ticker)
    if not client or not sym:
        return None
    try:
        q = client.quote(sym)
    except Exception:
        return None
    if not q or q.get("c") in (None, 0):
        return None
    price = q.get("c")
    prev = q.get("pc")
    change = q.get("d")
    change_pct = q.get("dp")
    return {
        "price": price,
        "change": change,
        "change_percent": change_pct,
        "volume": None,  # Finnhub quote endpoint omits volume; comes from candle
        "raw": q,
    }


def fetch_fundamentals(ticker: str) -> Optional[dict]:
    client = _get_client()
    sym = _normalize_ticker(ticker)
    if not client or not sym:
        return None
    try:
        metrics = client.company_basic_financials(sym, "all") or {}
        profile = client.company_profile2(symbol=sym) or {}
    except Exception:
        return None
    m = (metrics or {}).get("metric", {})
    if not m and not profile:
        return None
    return {
        "pe_ratio": m.get("peNormalizedAnnual") or m.get("peTTM"),
        "forward_pe": m.get("peExclExtraTTM"),
        "eps": m.get("epsBasicExclExtraItemsTTM") or m.get("epsTTM"),
        "revenue_growth": m.get("revenueGrowthTTMYoy"),
        "profit_margin": (m.get("netProfitMarginTTM") or 0) / 100 if m.get("netProfitMarginTTM") else None,
        "debt_to_equity": m.get("totalDebt/totalEquityAnnual"),
        "dividend_yield": (m.get("dividendYieldIndicatedAnnual") or 0) / 100 if m.get("dividendYieldIndicatedAnnual") else None,
        "beta": m.get("beta"),
        "market_cap": (profile.get("marketCapitalization") or 0) * 1_000_000 if profile.get("marketCapitalization") else None,
        "sector": profile.get("finnhubIndustry"),
        "industry": profile.get("finnhubIndustry"),
        "raw": {"metrics": m, "profile": profile},
    }
