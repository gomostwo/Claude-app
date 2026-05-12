"""US Energy Information Administration (EIA) adapter — official US oil/gas prices.

Free, requires API key from https://www.eia.gov/opendata/register.php.
Effectively unlimited request rate for personal use.

Series IDs (EIA v2 API):
  PET.RWTC.D            — Cushing OK WTI Spot Price FOB (daily, USD/bbl)
  PET.RBRTE.D           — Europe Brent Spot Price FOB (daily, USD/bbl)
  NG.RNGWHHD.D          — Henry Hub Natural Gas Spot Price (daily, USD/MMBtu)

The futures curve series live under petroleum/futures and natural-gas/futures
paths — those return contracts at varying tenors (used for contango/backwardation).
"""
from typing import Optional, List, Dict
import httpx
from ...config import settings

name = "eia"

BASE_URL = "https://api.eia.gov/v2"

# Underlying mapping for each commodity ETF
ETF_TO_EIA_SERIES = {
    "USO": "PET.RWTC.D",       # WTI front-month spot
    "BNO": "PET.RBRTE.D",      # Brent front-month spot
    "UNG": "NG.RNGWHHD.D",     # Henry Hub natural gas spot
}


def enabled() -> bool:
    return bool(settings.eia_api_key)


def _get_series(series_id: str, limit: int = 60) -> Optional[List[Dict]]:
    """Return most recent `limit` observations for a series, newest first."""
    if not settings.eia_api_key:
        return None
    path, *_ = series_id.split(".", 1)
    url = f"{BASE_URL}/seriesid/{series_id}"
    params = {
        "api_key": settings.eia_api_key,
        "length": limit,
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
    }
    try:
        r = httpx.get(url, params=params, timeout=15.0)
        r.raise_for_status()
        data = r.json()
        return (data.get("response") or {}).get("data") or []
    except Exception:
        return None


def fetch_series(series_id: str, limit: int = 60) -> Optional[dict]:
    """Return {latest_value, latest_period, history: [...], raw} for an EIA series."""
    rows = _get_series(series_id, limit=limit)
    if not rows:
        return None
    try:
        latest = rows[0]
        # EIA v2 puts the value under "value" but sometimes under series-specific key
        value = latest.get("value")
        if value is None:
            for k, v in latest.items():
                if k not in ("period", "duoarea", "area-name") and isinstance(v, (int, float)):
                    value = v
                    break
        return {
            "series_id": series_id,
            "latest_value": float(value) if value is not None else None,
            "latest_period": latest.get("period"),
            "history": rows,
        }
    except (KeyError, ValueError, TypeError):
        return None


def fetch_for_etf(ticker: str) -> Optional[dict]:
    """Look up the EIA series for an ETF and return its latest snapshot."""
    series_id = ETF_TO_EIA_SERIES.get(ticker)
    if not series_id:
        return None
    return fetch_series(series_id)
