"""Tiered AI router.

Tier 1 — cheap fan-out (DeepSeek V3) [added in PR5]
Tier 2 — Claude Haiku 4.5 with prompt caching
Tier 3 — Claude Sonnet 4.6 with prompt caching

This PR (PR4) implements Tier 2/3 only; Tier 1 stub returns `None`.
Promotion logic lives in scheduler.py (PR5).
"""
import hashlib
import json
from typing import Optional, Dict, Any, Literal
from dataclasses import dataclass, field

from ..ai.adapters import claude_adapter, deepseek_adapter
from ...utils.cache import stock_cache
from ...config import settings


Tier = Literal["t1", "t2", "t3"]


@dataclass
class AIRequest:
    ticker: str
    technical: Optional[dict] = None
    fundamental: Optional[dict] = None
    multi_provider: Optional[dict] = None
    commodity_signals: Optional[dict] = None
    user_profile: Optional[dict] = None
    purpose: str = "analysis"          # "screener" → t1; "analysis" → t2; "commit_grade" → t3


def _cache_key(req: AIRequest, tier: Tier) -> str:
    payload = {
        "tier": tier,
        "ticker": req.ticker,
        "technical": req.technical,
        "fundamental": req.fundamental,
        "multi_provider": req.multi_provider,
        "commodity_signals": req.commodity_signals,
        "user_profile": req.user_profile,
    }
    h = hashlib.md5(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()[:10]
    return f"ai:{tier}:{req.ticker}:{h}"


def _build_static_block(req: AIRequest) -> str:
    """The part of the prompt that's stable across recent calls (cacheable)."""
    parts = []
    if req.commodity_signals:
        regime = req.commodity_signals.get("components", {}).get("macro", {})
        if regime:
            parts.append(f"Macro regime: {regime.get('regime')} ({', '.join(regime.get('drivers') or [])})")
    return "\n".join(parts) or "No macro context available."


def _build_variable_block(req: AIRequest) -> str:
    """The part of the prompt that changes per call (NOT cached)."""
    sections = [f"Ticker: {req.ticker}"]

    if req.technical:
        t = req.technical
        techlines = []
        for k in ("rsi", "macd", "macd_signal", "macd_hist", "sma_20", "sma_50", "sma_200",
                  "bb_upper", "bb_middle", "bb_lower", "volume_ratio", "trend"):
            if t.get(k) is not None:
                techlines.append(f"  {k}: {t[k]}")
        if techlines:
            sections.append("Technical:\n" + "\n".join(techlines))

    if req.fundamental:
        f = req.fundamental
        funlines = []
        for k in ("pe_ratio", "forward_pe", "eps", "revenue_growth", "profit_margin",
                  "debt_to_equity", "dividend_yield", "beta", "sector", "industry"):
            if f.get(k) is not None:
                funlines.append(f"  {k}: {f[k]}")
        if funlines:
            sections.append("Fundamental:\n" + "\n".join(funlines))

    if req.commodity_signals:
        cs = req.commodity_signals
        sections.append(
            f"Composite commodity score: {cs.get('score')} (drivers: "
            f"{', '.join(cs.get('drivers') or [])})"
        )
        comps = cs.get("components") or {}
        if comps.get("term_structure"):
            ts = comps["term_structure"]
            sections.append(f"Term structure: {ts.get('regime')} (slope={ts.get('slope'):+.3f})")
        if comps.get("cot"):
            cot = comps["cot"]
            sections.append(f"COT net={cot.get('net'):,.0f} z={cot.get('z_score_52w'):+.2f}")

    if req.multi_provider:
        quotes = req.multi_provider.get("quotes") or {}
        if quotes:
            qlines = ["Cross-provider quotes:"]
            for prov, q in quotes.items():
                if q.get("error"):
                    qlines.append(f"  {prov}: error ({q['error']})")
                else:
                    qlines.append(f"  {prov}: price={q.get('price')} chg%={q.get('change_percent')}")
            sections.append("\n".join(qlines))

    sections.append(
        "Produce JSON: {recommendation, confidence, reasoning, key_signals, risks, target_price}."
    )
    return "\n\n".join(sections)


def run(req: AIRequest, *, tier: Tier) -> Optional[Dict[str, Any]]:
    """Execute the given tier. Cached by request payload."""
    key = _cache_key(req, tier)
    cached = stock_cache.get(key)
    if cached is not None:
        return cached

    static_block = _build_static_block(req)
    variable_block = _build_variable_block(req)

    if tier in ("t2", "t3"):
        result = claude_adapter.analyze(
            tier=tier,
            static_block=static_block,
            variable_block=variable_block,
            user_profile=req.user_profile,
        )
    elif tier == "t1":
        cs = req.commodity_signals or {}
        result = deepseek_adapter.screen(
            ticker=req.ticker,
            technical=req.technical,
            commodity_score=cs.get("score"),
            drivers=cs.get("drivers"),
        )
    else:
        return None

    if result is not None:
        stock_cache.set(key, result, settings.ai_cache_ttl)
    return result


# ── Promotion logic ────────────────────────────────────────────────────────

def should_promote_to_t2(
    *,
    tier1_result: Optional[dict],
    technical: Optional[dict],
    commodity_signals: Optional[dict],
    multi_provider: Optional[dict],
    prev_score: Optional[int] = None,
) -> tuple[bool, list[str]]:
    """Returns (promote, reasons). Tier 2 only fires if at least one trigger hits."""
    reasons: list[str] = []

    if tier1_result and tier1_result.get("verdict") == "candidate":
        reasons.append("tier1 verdict=candidate")

    # Score sign flip
    if commodity_signals and prev_score is not None:
        cur = commodity_signals.get("score") or 0
        if (cur > 0) != (prev_score > 0) and abs(cur - prev_score) > 5:
            reasons.append(f"score flipped {prev_score:+d} -> {cur:+d}")

    # RSI cross 30 or 70
    if technical and technical.get("rsi") is not None:
        rsi = technical["rsi"]
        if rsi <= 30 or rsi >= 70:
            reasons.append(f"rsi extreme ({rsi:.1f})")

    # MACD cross
    if technical and technical.get("macd_hist") is not None:
        # If hist is near zero and macd magnitude is non-trivial, treat as recent cross
        if abs(technical["macd_hist"]) < 0.05 and abs(technical.get("macd") or 0) > 0.1:
            reasons.append("macd near signal-line cross")

    # Bollinger break
    if technical and technical.get("bb_upper") is not None:
        last_close = technical.get("price") or technical.get("close")
        if last_close is not None:
            if last_close >= technical["bb_upper"]:
                reasons.append("bollinger upper break")
            elif last_close <= technical.get("bb_lower", float("inf")):
                reasons.append("bollinger lower break")

    # COT z-score extreme
    cot = (commodity_signals or {}).get("components", {}).get("cot") or {}
    z = cot.get("z_score_52w")
    if z is not None and abs(z) > 2:
        reasons.append(f"cot z-score extreme ({z:+.2f})")

    # Cross-provider price disagreement
    if multi_provider:
        prices = [
            q.get("price") for q in (multi_provider.get("quotes") or {}).values()
            if q and q.get("price") and not q.get("error")
        ]
        if len(prices) >= 2:
            spread = (max(prices) - min(prices)) / max(prices)
            if spread > 0.005:
                reasons.append(f"provider spread {spread*100:.2f}%")

    return (bool(reasons), reasons)


def should_promote_to_t3(
    *,
    tier2_result: Optional[dict],
    risk_precheck_ok: bool,
) -> tuple[bool, list[str]]:
    """Tier 3 only if all conditions met."""
    reasons: list[str] = []
    if not tier2_result:
        return (False, ["no tier2 result"])
    if tier2_result.get("error"):
        return (False, [f"tier2 error: {tier2_result['error']}"])

    confidence = tier2_result.get("confidence") or 0
    rec = (tier2_result.get("recommendation") or "").upper()

    if confidence < 70:
        reasons.append(f"confidence {confidence} < 70")
    if rec not in ("BUY", "SELL"):
        reasons.append(f"recommendation {rec} not actionable")
    if not risk_precheck_ok:
        reasons.append("risk pre-check failed")

    return (not reasons, reasons or ["all gates passed"])
