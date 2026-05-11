import json
import hashlib
from datetime import datetime, timezone
from typing import Optional
from anthropic import Anthropic
from ..config import settings
from ..utils.cache import stock_cache
from .stock_data import COMMODITY_TICKERS

client = Anthropic(api_key=settings.anthropic_api_key)


def _profile_hash(user_profile: dict) -> str:
    serialized = json.dumps(user_profile, sort_keys=True)
    return hashlib.md5(serialized.encode()).hexdigest()[:8]


def _format_multi_provider(mp: dict) -> str:
    """Render multi-provider quotes/fundamentals as a comparison block for the AI."""
    if not mp:
        return ""
    lines = []
    quotes = mp.get("quotes") or {}
    if quotes:
        lines.append("**Cross-Provider Quotes:**")
        for provider, q in quotes.items():
            if q.get("error"):
                lines.append(f"- {provider}: error ({q['error']})")
            else:
                lines.append(
                    f"- {provider}: price={q.get('price')}, "
                    f"chg%={q.get('change_percent')}, vol={q.get('volume')}"
                )
    funds = mp.get("fundamentals") or {}
    if funds:
        lines.append("\n**Cross-Provider Fundamentals:**")
        for provider, f in funds.items():
            if f.get("error"):
                lines.append(f"- {provider}: error ({f['error']})")
                continue
            lines.append(
                f"- {provider}: P/E={f.get('pe_ratio')}, FwdP/E={f.get('forward_pe')}, "
                f"EPS={f.get('eps')}, RevGrowth={f.get('revenue_growth')}, "
                f"ProfitMargin={f.get('profit_margin')}, D/E={f.get('debt_to_equity')}, "
                f"DivYld={f.get('dividend_yield')}, Beta={f.get('beta')}, "
                f"Sector={f.get('sector')}"
            )
    return "\n".join(lines)


def run_ai_analysis(
    ticker: str,
    technical: dict,
    fundamental: Optional[dict],
    user_profile: Optional[dict] = None,
    multi_provider: Optional[dict] = None,
) -> Optional[dict]:
    """Call Claude API to generate a personalized stock recommendation."""

    profile_hash = _profile_hash(user_profile or {})
    mp_hash = hashlib.md5(
        json.dumps(multi_provider or {}, sort_keys=True, default=str).encode()
    ).hexdigest()[:6] if multi_provider else "none"
    cache_key = f"ai:{ticker}:{profile_hash}:{mp_hash}"
    cached = stock_cache.get(cache_key)
    if cached is not None:
        return cached

    is_commodity = ticker in COMMODITY_TICKERS
    asset_label = "commodity" if is_commodity else "stock"

    # Build user context
    user_context = ""
    if user_profile:
        user_context = f"""
**Investor Profile:**
- Budget: ${user_profile.get('budget', 'unknown'):,} USD
- Investment Style: {user_profile.get('investment_style', 'not specified')}
- Time Horizon: {user_profile.get('time_horizon', 'not specified')}
- Risk Tolerance: {user_profile.get('risk_tolerance', 'not specified')}
"""

    # Build technical context
    tech_lines = []
    if technical:
        if technical.get("rsi") is not None:
            tech_lines.append(f"RSI (14): {technical['rsi']:.1f}")
        if technical.get("macd") is not None:
            tech_lines.append(f"MACD: {technical['macd']:.4f} | Signal: {technical.get('macd_signal', 'N/A')} | Hist: {technical.get('macd_hist', 'N/A')}")
        if technical.get("sma_20") is not None:
            tech_lines.append(f"SMA 20: {technical['sma_20']:.2f}")
        if technical.get("sma_50") is not None:
            tech_lines.append(f"SMA 50: {technical['sma_50']:.2f}")
        if technical.get("sma_200") is not None:
            tech_lines.append(f"SMA 200: {technical['sma_200']:.2f}")
        if technical.get("bb_upper") is not None:
            tech_lines.append(f"Bollinger Bands: {technical['bb_lower']:.2f} / {technical['bb_middle']:.2f} / {technical['bb_upper']:.2f}")
        if technical.get("volume_ratio") is not None:
            tech_lines.append(f"Volume Ratio (vs 20d avg): {technical['volume_ratio']:.2f}x")
        tech_lines.append(f"Trend: {technical.get('trend', 'unknown')}")

    tech_context = "\n".join(tech_lines)

    # Build fundamental context (stocks only)
    fund_context = ""
    if fundamental and not is_commodity:
        fund_lines = []
        if fundamental.get("pe_ratio") is not None:
            fund_lines.append(f"P/E Ratio: {fundamental['pe_ratio']:.1f}")
        if fundamental.get("forward_pe") is not None:
            fund_lines.append(f"Forward P/E: {fundamental['forward_pe']:.1f}")
        if fundamental.get("eps") is not None:
            fund_lines.append(f"EPS: ${fundamental['eps']:.2f}")
        if fundamental.get("revenue_growth") is not None:
            fund_lines.append(f"Revenue Growth: {fundamental['revenue_growth']*100:.1f}%")
        if fundamental.get("profit_margin") is not None:
            fund_lines.append(f"Profit Margin: {fundamental['profit_margin']*100:.1f}%")
        if fundamental.get("debt_to_equity") is not None:
            fund_lines.append(f"Debt/Equity: {fundamental['debt_to_equity']:.2f}")
        if fundamental.get("dividend_yield") is not None:
            fund_lines.append(f"Dividend Yield: {fundamental['dividend_yield']*100:.2f}%")
        if fundamental.get("beta") is not None:
            fund_lines.append(f"Beta: {fundamental['beta']:.2f}")
        if fundamental.get("sector"):
            fund_lines.append(f"Sector: {fundamental['sector']} | Industry: {fundamental.get('industry', 'N/A')}")
        fund_context = "\n".join(fund_lines)

    multi_provider_block = _format_multi_provider(multi_provider) if multi_provider else ""

    prompt = f"""You are a professional financial analyst. Analyze the following {asset_label} and provide a trading recommendation.

**Asset:** {ticker}
{user_context}
**Technical Analysis:**
{tech_context}

{"**Fundamental Analysis:**" + chr(10) + fund_context if fund_context else ""}

{multi_provider_block}

When cross-provider data is present, note any meaningful disagreement between sources in your reasoning, and weigh values by consensus rather than any single provider.

Based on this data, provide a JSON response with the following structure:
{{
  "recommendation": "BUY" | "SELL" | "HOLD",
  "confidence": <integer 0-100>,
  "reasoning": "<2-3 sentence explanation tailored to the investor profile>",
  "key_signals": ["<signal 1>", "<signal 2>", ...],
  "risks": ["<risk 1>", "<risk 2>", ...],
  "target_price": <float or null>
}}

Return ONLY valid JSON, no markdown code blocks.
Consider the investor's profile when forming the recommendation.
Keep reasoning concise and actionable."""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        # Strip markdown code block if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        result["ticker"] = ticker
        result["analysis_timestamp"] = datetime.now(timezone.utc).isoformat()

        stock_cache.set(cache_key, result, settings.ai_cache_ttl)
        return result

    except Exception as e:
        print(f"AI analysis error for {ticker}: {e}")
        return None
