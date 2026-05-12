import asyncio
from typing import Optional
from ..config import settings


async def send_telegram_message(chat_id: str, text: str) -> bool:
    """Send a Telegram message to a specific chat ID."""
    if not settings.telegram_bot_token or not chat_id:
        return False
    try:
        from telegram import Bot
        bot = Bot(token=settings.telegram_bot_token)
        await bot.send_message(
            chat_id=chat_id,
            text=text,
            parse_mode="Markdown",
        )
        return True
    except Exception as e:
        print(f"Telegram send error (chat_id={chat_id}): {e}")
        return False


def send_telegram_sync(chat_id: str, text: str) -> bool:
    """Synchronous wrapper for sending Telegram messages."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Schedule as a task if already in async context
            asyncio.ensure_future(send_telegram_message(chat_id, text))
            return True
        else:
            return loop.run_until_complete(send_telegram_message(chat_id, text))
    except Exception as e:
        print(f"Telegram sync error: {e}")
        return False


def format_recommendation_message(ticker: str, ai_result: dict, price: Optional[float] = None) -> str:
    rec = ai_result.get("recommendation", "HOLD")
    confidence = ai_result.get("confidence", 0)
    reasoning = ai_result.get("reasoning", "")
    signals = ai_result.get("key_signals", [])
    risks = ai_result.get("risks", [])
    target = ai_result.get("target_price")

    emoji = {"BUY": "🟢", "SELL": "🔴", "HOLD": "🟡"}.get(rec, "⚪")

    lines = [
        f"{emoji} *{ticker}* — {rec} (Confidence: {confidence}%)",
    ]
    if price:
        lines.append(f"💰 Current Price: ${price:,.2f}")
    if target:
        lines.append(f"🎯 Target Price: ${target:,.2f}")
    lines.append(f"\n📊 *Analysis:* {reasoning}")
    if signals:
        lines.append("\n✅ *Key Signals:*")
        for s in signals[:3]:
            lines.append(f"  • {s}")
    if risks:
        lines.append("\n⚠️ *Risks:*")
        for r in risks[:2]:
            lines.append(f"  • {r}")

    return "\n".join(lines)


def format_alert_message(ticker: str, alert_type: str, message: str) -> str:
    emoji_map = {
        "price_above": "📈",
        "price_below": "📉",
        "rsi_alert": "📊",
        "ai_recommendation": "🤖",
        "system": "ℹ️",
    }
    emoji = emoji_map.get(alert_type, "🔔")
    return f"{emoji} *Alert: {ticker}*\n{message}"


def format_daily_summary(date_str: str, macro_regime: Optional[dict], sections: list) -> str:
    """Build the end-of-day digest message for a single user.

    sections is a list of per-ticker dicts produced by the scheduler:
      {ticker, price, day_change_pct, tier, verdict, recommendation,
       confidence, reasoning, target_price, alerts: [...], commodity_score}
    """
    lines = [f"📅 *Daily Market Summary* — {date_str}"]

    if macro_regime:
        regime = macro_regime.get("regime_label") or "—"
        dxy = macro_regime.get("dxy")
        real_y = macro_regime.get("real_10y")
        bei = macro_regime.get("inflation_breakeven_10y")
        macro_line = f"🌐 Regime: *{regime}*"
        bits = []
        if dxy is not None:
            bits.append(f"DXY {dxy:.2f}")
        if real_y is not None:
            bits.append(f"Real 10Y {real_y:.2f}%")
        if bei is not None:
            bits.append(f"Breakeven {bei:.2f}%")
        if bits:
            macro_line += "  •  " + "  ".join(bits)
        lines.append(macro_line)

    actionable = [s for s in sections if s.get("recommendation") in ("BUY", "SELL")]
    watched    = [s for s in sections if s.get("recommendation") not in ("BUY", "SELL")]

    if actionable:
        lines.append("\n🎯 *Actionable (Tier 3)*")
        for s in actionable:
            emoji = {"BUY": "🟢", "SELL": "🔴"}.get(s["recommendation"], "⚪")
            head = f"{emoji} *{s['ticker']}* {s['recommendation']} ({s.get('confidence', 0)}%)"
            if s.get("price") is not None:
                head += f"  @ ${s['price']:,.2f}"
            if s.get("day_change_pct") is not None:
                head += f"  ({s['day_change_pct']:+.2f}%)"
            lines.append(head)
            if s.get("target_price"):
                lines.append(f"   🎯 Target ${s['target_price']:,.2f}")
            if s.get("reasoning"):
                lines.append(f"   {s['reasoning'][:240]}")

    if watched:
        lines.append("\n👀 *Watching*")
        for s in watched:
            chg = f"{s['day_change_pct']:+.2f}%" if s.get("day_change_pct") is not None else "—"
            price = f"${s['price']:,.2f}" if s.get("price") is not None else "—"
            tier = s.get("tier", "—")
            verdict = s.get("verdict") or s.get("recommendation") or "—"
            line = f"• {s['ticker']}  {price}  {chg}  [{tier}: {verdict}]"
            if s.get("commodity_score") is not None:
                line += f"  score {s['commodity_score']:+d}"
            lines.append(line)
            for alert in s.get("alerts", []):
                lines.append(f"   ⚠️ {alert}")

    if not actionable and not watched:
        lines.append("\n_No watchlist tickers analyzed today._")

    return "\n".join(lines)
