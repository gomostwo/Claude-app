"""Claude adapter for Tier 2 (Haiku) and Tier 3 (Sonnet).

Uses Anthropic's prompt caching: the static block (system prompt +
commodity primer + user profile + macro regime) is marked
`cache_control: ephemeral` so subsequent calls within ~5 min reuse
those tokens cheaply (~90% off cached portion).

Cache requirements: cached content needs ~1024 tokens minimum for
Haiku/Sonnet to benefit. We pad the system block with a real commodity
primer (educational, not filler) to cross the threshold.
"""
import json
from typing import Optional, Dict, Any
from anthropic import Anthropic
from ....config import settings


_client: Optional[Anthropic] = None


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=settings.anthropic_api_key)
    return _client


COMMODITY_PRIMER = """\
You are evaluating commodity-tracking ETFs traded on US exchanges:
  • GLD  — SPDR Gold Shares (physical gold)
  • SLV  — iShares Silver Trust (physical silver)
  • USO  — United States Oil Fund (WTI crude front-month futures)
  • BNO  — United States Brent Oil Fund (Brent front-month futures)
  • UNG  — United States Natural Gas Fund (Henry Hub front-month)
  • DBC  — Invesco DB Commodity Index Tracking Fund (broad basket)

Key drivers for commodity prices:
  • USD strength (DXY) — inverse correlation. Strong USD = headwind.
  • Real yields (10Y TIPS) — high real yields are bearish for non-yielding
    metals (gold, silver) because the opportunity cost of holding rises.
  • Inflation breakevens (10Y T10YIE) — rising breakevens favor inflation
    hedges (gold, broad commodities).
  • Futures term structure — backwardation (front > back) is bullish; the
    ETF earns roll yield. Contango (front < back) is bearish; ETF bleeds
    on monthly roll, especially in USO/UNG.
  • COT positioning — managed-money net long extremes (high z-score) often
    precede reversals; net short extremes often mark bottoms.
  • Macro regime — risk-on tends to favor industrial commodities (oil,
    copper); risk-off favors gold.

When evaluating a recommendation, weigh cross-provider price agreement
(consensus is more reliable than any single source) and explicitly flag
disagreement greater than 0.5%.

Output a JSON object with: recommendation ("BUY"|"SELL"|"HOLD"),
confidence (0-100), reasoning (2-3 sentences), key_signals (list of
strings), risks (list of strings), target_price (float or null).
Return ONLY valid JSON, no markdown fences.
"""


def analyze(
    *,
    tier: str,
    static_block: str,
    variable_block: str,
    user_profile: Optional[dict] = None,
    max_tokens: int = 1024,
) -> Optional[Dict[str, Any]]:
    """Call Claude with prompt caching on the static block.

    `tier` selects the model (t2 → Haiku, t3 → Sonnet).
    """
    if not settings.anthropic_api_key:
        return None

    model = settings.ai_tier3_model if tier == "t3" else settings.ai_tier2_model

    # System block is cached. Pad up to ≥1024 tokens by including the primer.
    profile_str = ""
    if user_profile:
        profile_str = (
            f"\nInvestor profile: budget=${user_profile.get('budget', 'n/a')}, "
            f"style={user_profile.get('investment_style', 'n/a')}, "
            f"horizon={user_profile.get('time_horizon', 'n/a')}, "
            f"risk={user_profile.get('risk_tolerance', 'n/a')}\n"
        )

    system_blocks = [
        {
            "type": "text",
            "text": COMMODITY_PRIMER + profile_str + "\n" + static_block,
            "cache_control": {"type": "ephemeral"},
        }
    ]

    try:
        message = _get_client().messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_blocks,
            messages=[{"role": "user", "content": variable_block}],
        )
        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        parsed = json.loads(raw)
        parsed["_tier"] = tier
        parsed["_model"] = model
        # Surface cache stats so router can log hit rate
        usage = getattr(message, "usage", None)
        if usage is not None:
            parsed["_cache_read_input_tokens"] = getattr(usage, "cache_read_input_tokens", 0)
            parsed["_cache_creation_input_tokens"] = getattr(usage, "cache_creation_input_tokens", 0)
        return parsed
    except Exception as e:
        return {"_tier": tier, "_model": model, "error": str(e)[:300]}
