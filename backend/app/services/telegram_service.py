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
