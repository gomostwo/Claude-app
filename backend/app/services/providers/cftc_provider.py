"""CFTC Commitments of Traders (COT) adapter — weekly positioning data.

Public, no API key required. Uses the CFTC Socrata data portal which
exposes the disaggregated futures-only report as JSON.

Endpoint: https://publicreporting.cftc.gov/resource/72hh-3qpy.json
Filter: cftc_contract_market_code = <code>, market_and_exchange_names = '<name>'

Underlying mapping for each commodity ETF (the COT report is for the
futures contract; the ETF tracks the same underlying so positioning of
managed money in futures is a leading signal for ETF flow direction).

Market codes (CFTC):
  088691  GOLD - COMMODITY EXCHANGE INC. (gold; underlying for GLD)
  084691  SILVER - COMMODITY EXCHANGE INC. (silver; underlying for SLV)
  067651  CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE (WTI; underlying for USO)
  06765T  BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE (Brent; underlying for BNO)
  023651  NATURAL GAS - NEW YORK MERCANTILE EXCHANGE (Henry Hub; underlying for UNG)
"""
from typing import Optional, List, Dict
from statistics import mean, pstdev
import httpx

name = "cftc"

BASE_URL = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json"

ETF_TO_COT_CODE = {
    "GLD": "088691",
    "SLV": "084691",
    "USO": "067651",
    "BNO": "06765T",
    "UNG": "023651",
}


def enabled() -> bool:
    return True  # public dataset, no key


def fetch_cot(market_code: str, limit: int = 52) -> Optional[List[Dict]]:
    """Return the most recent `limit` weekly COT rows for a market code, newest first."""
    params = {
        "$where": f"cftc_contract_market_code='{market_code}'",
        "$order": "report_date_as_yyyy_mm_dd DESC",
        "$limit": limit,
    }
    try:
        r = httpx.get(BASE_URL, params=params, timeout=15.0)
        r.raise_for_status()
        return r.json() or []
    except Exception:
        return None


def cot_net_positioning(market_code: str, lookback_weeks: int = 52) -> Optional[dict]:
    """Compute managed-money net (long - short) and 52-week z-score.

    Returns {net, latest_date, mean_52w, std_52w, z_score_52w, history_count}.
    """
    rows = fetch_cot(market_code, limit=lookback_weeks)
    if not rows:
        return None

    nets: List[float] = []
    for row in rows:
        try:
            long_ = float(row.get("m_money_positions_long_all") or 0)
            short = float(row.get("m_money_positions_short_all") or 0)
            nets.append(long_ - short)
        except (TypeError, ValueError):
            continue
    if len(nets) < 4:
        return None

    latest = nets[0]
    mu = mean(nets)
    sigma = pstdev(nets) or 1.0  # avoid divide-by-zero
    z = (latest - mu) / sigma

    return {
        "net": latest,
        "latest_date": rows[0].get("report_date_as_yyyy_mm_dd"),
        "mean_52w": mu,
        "std_52w": sigma,
        "z_score_52w": z,
        "history_count": len(nets),
    }


def cot_for_etf(ticker: str) -> Optional[dict]:
    code = ETF_TO_COT_CODE.get(ticker)
    if not code:
        return None
    return cot_net_positioning(code)
