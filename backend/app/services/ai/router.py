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

from ..ai.adapters import claude_adapter
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
        # DeepSeek adapter wired in PR5
        return None
    else:
        return None

    if result is not None:
        stock_cache.set(key, result, settings.ai_cache_ttl)
    return result
