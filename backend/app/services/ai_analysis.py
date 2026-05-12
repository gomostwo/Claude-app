"""Backwards-compatible wrapper around the new tiered AI router.

The router (services/ai/router.py) is the modern entry point.
`run_ai_analysis` is preserved here for the existing scheduler and
/api/stocks/{ticker}/analyze callers; it now routes to Tier 3
(commit-grade) Claude Sonnet via the router with prompt caching.
"""
from datetime import datetime, timezone
from typing import Optional
from .ai.router import AIRequest, run as router_run


def run_ai_analysis(
    ticker: str,
    technical: dict,
    fundamental: Optional[dict],
    user_profile: Optional[dict] = None,
    multi_provider: Optional[dict] = None,
    commodity_signals_snapshot: Optional[dict] = None,
) -> Optional[dict]:
    """Run a Tier 3 (commit-grade) analysis. Returns the parsed JSON dict
    plus router metadata (`_tier`, `_model`, cache token counts) for logging.
    """
    req = AIRequest(
        ticker=ticker,
        technical=technical,
        fundamental=fundamental,
        multi_provider=multi_provider,
        commodity_signals=commodity_signals_snapshot,
        user_profile=user_profile,
        purpose="commit_grade",
    )
    result = router_run(req, tier="t3")
    if result is None or result.get("error"):
        return result
    result["ticker"] = ticker
    result["analysis_timestamp"] = datetime.now(timezone.utc).isoformat()
    return result
