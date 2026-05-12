"""Commodity-specific signal computations.

All functions are pure-ish — they call provider modules to fetch raw data
then derive deterministic signals. The AI router never recomputes these;
they're cached snapshots fed into prompts.

Signals:
  term_structure(ticker)  — contango vs backwardation from front/second futures
  cot_positioning(ticker) — managed-money net + 52w z-score
  macro_regime()          — DXY trend, real yield, breakeven inflation → regime label
  etf_flow(ticker)        — AUM change vs prior snapshot
  commodity_score(ticker) — composite of the above
"""
from typing import Optional, Dict, Any
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from .providers import eia_provider, fred_provider, cftc_provider
from ..models import ProviderQuote


# ── Term structure ──────────────────────────────────────────────────────────

def term_structure(ticker: str) -> Optional[Dict[str, Any]]:
    """Slope of the front-curve from EIA spot vs. a near-future point.

    EIA exposes spot prices but only limited futures-curve data through the
    standard v2 series. For the public API tier we approximate the curve
    with: (current spot) vs (avg of last 5 trading days) — a short-horizon
    trend proxy. Real backwardation/contango computation would need a
    futures-curve subscription; we keep this as a documented approximation.
    """
    snap = eia_provider.fetch_for_etf(ticker)
    if not snap or not snap.get("history") or len(snap["history"]) < 6:
        return None

    hist = snap["history"]
    # Each row's primary numeric is 'value' in v2; extract defensively
    def _value(row):
        v = row.get("value")
        if v is None:
            for k, val in row.items():
                if k != "period" and isinstance(val, (int, float)):
                    return float(val)
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    latest = _value(hist[0])
    prior = [_value(r) for r in hist[1:6] if _value(r) is not None]
    if latest is None or len(prior) < 3:
        return None

    avg_prior = sum(prior) / len(prior)
    slope = latest - avg_prior
    regime = "backwardation" if slope > 0 else "contango"  # spot > prior avg ≈ rising front (backwardation proxy)

    return {
        "ticker": ticker,
        "latest_spot": latest,
        "avg_prior_5d": avg_prior,
        "slope": slope,
        "regime": regime,
        "note": "spot vs 5d avg proxy; not a true futures-curve slope",
    }


# ── COT positioning ─────────────────────────────────────────────────────────

def cot_positioning(ticker: str) -> Optional[Dict[str, Any]]:
    return cftc_provider.cot_for_etf(ticker)


# ── Macro regime ────────────────────────────────────────────────────────────

def macro_regime() -> Optional[Dict[str, Any]]:
    """Classify the current commodity-relevant macro environment.

    Looks at:
      • DXY level vs 6-month average (USD strength → headwind for commodities)
      • 10Y real yield (DFII10) — high real yields = bad for non-yielding assets like gold
      • 10Y inflation breakeven (T10YIE) — inflation regime
    """
    if not fred_provider.enabled():
        return {"regime": "unknown", "reason": "FRED API key not configured"}

    snap = fred_provider.fetch_macro_snapshot()

    def _series_trend(series: Optional[dict]) -> Optional[Dict[str, Any]]:
        if not series or not series.get("history"):
            return None
        h = series["history"]
        latest = h[0]["value"]
        if len(h) < 30:
            return {"latest": latest, "avg_6m": None, "delta_vs_avg": None}
        # FRED returns desc order; first 120 obs ≈ ~6 months of daily data
        recent = [r["value"] for r in h[:120]]
        avg6 = sum(recent) / len(recent)
        return {"latest": latest, "avg_6m": avg6, "delta_vs_avg": latest - avg6}

    dxy = _series_trend(snap.get("dxy"))
    real10 = _series_trend(snap.get("real_10y"))
    breakeven = _series_trend(snap.get("inflation_breakeven_10y"))

    # Simple heuristic — feed labels to AI rather than fitting a model
    regime = "neutral"
    drivers = []

    if dxy and dxy["delta_vs_avg"] is not None:
        if dxy["delta_vs_avg"] > 1.0:
            regime = "usd_strength_headwind"
            drivers.append(f"DXY +{dxy['delta_vs_avg']:.2f} vs 6m avg")
        elif dxy["delta_vs_avg"] < -1.0:
            regime = "usd_weakness_tailwind"
            drivers.append(f"DXY {dxy['delta_vs_avg']:.2f} vs 6m avg")

    if real10 and real10["latest"] is not None:
        if real10["latest"] > 2.0:
            drivers.append(f"high real yield {real10['latest']:.2f}% (bearish gold)")
        elif real10["latest"] < 0.5:
            drivers.append(f"low real yield {real10['latest']:.2f}% (bullish gold)")

    if breakeven and breakeven["latest"] is not None:
        drivers.append(f"10Y inflation breakeven {breakeven['latest']:.2f}%")

    return {
        "regime": regime,
        "dxy": dxy,
        "real_yield_10y": real10,
        "inflation_breakeven_10y": breakeven,
        "drivers": drivers,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


# ── ETF flow ────────────────────────────────────────────────────────────────

def etf_flow(db: Session, ticker: str, lookback_count: int = 30) -> Optional[Dict[str, Any]]:
    """Approximate fund-flow signal from successive ProviderQuote.aum snapshots."""
    rows = (
        db.query(ProviderQuote)
        .filter(ProviderQuote.ticker == ticker, ProviderQuote.aum.isnot(None))
        .order_by(ProviderQuote.fetched_at.desc())
        .limit(lookback_count)
        .all()
    )
    if len(rows) < 2:
        return None
    latest_aum = rows[0].aum
    prior_aum = rows[-1].aum
    delta = latest_aum - prior_aum
    pct = (delta / prior_aum * 100) if prior_aum else None
    return {
        "latest_aum": latest_aum,
        "prior_aum": prior_aum,
        "samples": len(rows),
        "delta_pct": pct,
    }


# ── Composite score ────────────────────────────────────────────────────────

def commodity_score(db: Session, ticker: str) -> Dict[str, Any]:
    """Combine term structure, COT, macro, and flow into a single -100..+100 score
    plus the list of contributing drivers. Used as the deterministic gate
    before invoking the AI router.
    """
    ts = term_structure(ticker)
    cot = cot_positioning(ticker)
    macro = macro_regime()
    flow = etf_flow(db, ticker)

    score = 0
    drivers = []

    if ts:
        if ts["regime"] == "backwardation":
            score += 15
            drivers.append("backwardation (bullish)")
        else:
            score -= 10
            drivers.append("contango (bearish)")

    if cot and cot.get("z_score_52w") is not None:
        z = cot["z_score_52w"]
        contrib = max(-30, min(30, int(z * 15)))
        score += contrib
        drivers.append(f"COT z={z:+.2f} → {contrib:+d}")

    if macro:
        if macro["regime"] == "usd_weakness_tailwind":
            score += 15
            drivers.append("USD weakness tailwind")
        elif macro["regime"] == "usd_strength_headwind":
            score -= 15
            drivers.append("USD strength headwind")
        if macro.get("real_yield_10y", {}).get("latest", 0) or 0 > 2.0:
            if ticker in ("GLD", "SLV"):
                score -= 10
                drivers.append("high real yields bearish for metals")

    if flow and flow.get("delta_pct") is not None:
        if flow["delta_pct"] > 2.0:
            score += 5
            drivers.append(f"AUM rising {flow['delta_pct']:.1f}%")
        elif flow["delta_pct"] < -2.0:
            score -= 5
            drivers.append(f"AUM falling {flow['delta_pct']:.1f}%")

    score = max(-100, min(100, score))
    return {
        "ticker": ticker,
        "score": score,
        "drivers": drivers,
        "components": {
            "term_structure": ts,
            "cot": cot,
            "macro": macro,
            "flow": flow,
        },
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
