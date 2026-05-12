"""DeepSeek V3 adapter for Tier 1 (cheap screener).

Uses the OpenAI-compatible API at api.deepseek.com (model = deepseek-chat).
Output is a compact verdict so downstream gating is fast & cheap.
"""
import json
from typing import Optional, Dict, Any
import httpx
from ....config import settings

BASE_URL = "https://api.deepseek.com/v1/chat/completions"


def enabled() -> bool:
    return bool(settings.deepseek_api_key)


def screen(
    *,
    ticker: str,
    technical: Optional[dict],
    commodity_score: Optional[int],
    drivers: Optional[list],
    max_tokens: int = 256,
) -> Optional[Dict[str, Any]]:
    """Cheap one-shot screener. Returns {verdict, score, reason} or None.

    verdict ∈ {"skip", "watch", "candidate"}
      skip      → no further action this cycle
      watch     → log only
      candidate → promote to Tier 2
    """
    if not settings.deepseek_api_key:
        return None

    rsi = (technical or {}).get("rsi")
    macd_hist = (technical or {}).get("macd_hist")
    trend = (technical or {}).get("trend")

    user_msg = (
        f"Commodity ETF: {ticker}\n"
        f"Composite score: {commodity_score}\n"
        f"Drivers: {', '.join(drivers or [])}\n"
        f"Technical: rsi={rsi}, macd_hist={macd_hist}, trend={trend}\n\n"
        "Decide if this warrants deeper analysis right now. "
        "Output ONLY a JSON object: "
        '{"verdict": "skip"|"watch"|"candidate", "score": 0-100, "reason": "<one line>"}'
    )

    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.ai_tier1_model,
        "messages": [
            {"role": "system", "content": "You are a fast commodity-ETF screener. Output strict JSON only."},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    try:
        r = httpx.post(BASE_URL, headers=headers, json=body, timeout=20.0)
        r.raise_for_status()
        data = r.json()
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        parsed["_tier"] = "t1"
        parsed["_model"] = settings.ai_tier1_model
        return parsed
    except Exception as e:
        return {"_tier": "t1", "_model": settings.ai_tier1_model, "error": str(e)[:300]}
