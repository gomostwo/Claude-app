"""St. Louis Fed FRED adapter — macro context that drives commodity prices.

Free, requires API key from https://fred.stlouisfed.org/docs/api/api_key.html.
Effectively unlimited request rate for personal use.

Default series used by commodity_signals.macro_regime():
  DTWEXBGS  — Trade-weighted USD index (broad)
  DGS10     — 10-Year Treasury yield
  DFII10    — 10-Year TIPS (real yield)
  T10YIE    — 10-Year inflation breakeven
  CPIAUCSL  — CPI urban consumers (monthly)
"""
from typing import Optional, List, Dict
from datetime import date, timedelta
import httpx
from ...config import settings

name = "fred"

BASE_URL = "https://api.stlouisfed.org/fred/series/observations"

MACRO_SERIES = {
    "dxy": "DTWEXBGS",
    "nominal_10y": "DGS10",
    "real_10y": "DFII10",
    "inflation_breakeven_10y": "T10YIE",
    "cpi": "CPIAUCSL",
}


def enabled() -> bool:
    return bool(settings.fred_api_key)


def fetch_series(series_id: str, lookback_days: int = 180) -> Optional[dict]:
    """Return {latest_value, latest_date, history: [...]} for a FRED series."""
    if not settings.fred_api_key:
        return None
    start = (date.today() - timedelta(days=lookback_days)).isoformat()
    params = {
        "series_id": series_id,
        "api_key": settings.fred_api_key,
        "file_type": "json",
        "observation_start": start,
        "sort_order": "desc",
    }
    try:
        r = httpx.get(BASE_URL, params=params, timeout=15.0)
        r.raise_for_status()
        obs = (r.json() or {}).get("observations") or []
    except Exception:
        return None

    # Filter "." (FRED's null sentinel) and parse floats
    parsed = []
    for o in obs:
        v = o.get("value")
        if v in (None, ".", ""):
            continue
        try:
            parsed.append({"date": o.get("date"), "value": float(v)})
        except (TypeError, ValueError):
            continue
    if not parsed:
        return None
    return {
        "series_id": series_id,
        "latest_value": parsed[0]["value"],
        "latest_date": parsed[0]["date"],
        "history": parsed,
    }


def fetch_macro_snapshot() -> dict:
    """Pull every series in MACRO_SERIES and return a flat snapshot dict."""
    out: Dict[str, Optional[dict]] = {}
    for label, series_id in MACRO_SERIES.items():
        out[label] = fetch_series(series_id)
    return out
