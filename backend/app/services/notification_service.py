from sqlalchemy.orm import Session
from typing import Optional
from ..models.notification import Notification
from ..models.watchlist import WatchlistItem
from .telegram_service import (
    send_telegram_sync,
    format_recommendation_message,
    format_alert_message,
    format_daily_summary,
)


def create_notification(
    db: Session,
    user_id: int,
    ticker: str,
    notif_type: str,
    title: str,
    message: str,
    telegram_chat_id: Optional[str] = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        ticker=ticker,
        type=notif_type,
        title=title,
        message=message,
    )
    db.add(notif)
    db.flush()  # get ID before commit

    # Send Telegram
    if telegram_chat_id:
        tg_text = format_alert_message(ticker, notif_type, message)
        sent = send_telegram_sync(telegram_chat_id, tg_text)
        notif.telegram_sent = sent

    db.commit()
    db.refresh(notif)
    return notif


def check_price_alerts(
    db: Session,
    user_id: int,
    item: WatchlistItem,
    current_price: float,
    telegram_chat_id: Optional[str],
) -> None:
    if item.alert_price_above and current_price >= item.alert_price_above:
        create_notification(
            db, user_id, item.ticker,
            "price_above",
            f"{item.ticker} crossed above ${item.alert_price_above:,.2f}",
            f"{item.ticker} is now ${current_price:,.2f} — above your alert of ${item.alert_price_above:,.2f}",
            telegram_chat_id,
        )

    if item.alert_price_below and current_price <= item.alert_price_below:
        create_notification(
            db, user_id, item.ticker,
            "price_below",
            f"{item.ticker} dropped below ${item.alert_price_below:,.2f}",
            f"{item.ticker} is now ${current_price:,.2f} — below your alert of ${item.alert_price_below:,.2f}",
            telegram_chat_id,
        )


def check_rsi_alerts(
    db: Session,
    user_id: int,
    item: WatchlistItem,
    rsi: float,
    telegram_chat_id: Optional[str],
) -> None:
    if item.alert_rsi_overbought and rsi > 70:
        create_notification(
            db, user_id, item.ticker,
            "rsi_alert",
            f"{item.ticker} RSI overbought ({rsi:.1f})",
            f"{item.ticker} RSI reached {rsi:.1f} — overbought territory (>70). Consider taking profits.",
            telegram_chat_id,
        )

    if item.alert_rsi_oversold and rsi < 30:
        create_notification(
            db, user_id, item.ticker,
            "rsi_alert",
            f"{item.ticker} RSI oversold ({rsi:.1f})",
            f"{item.ticker} RSI reached {rsi:.1f} — oversold territory (<30). Possible buying opportunity.",
            telegram_chat_id,
        )


def send_ai_recommendation_notification(
    db: Session,
    user_id: int,
    ticker: str,
    ai_result: dict,
    current_price: Optional[float],
    telegram_chat_id: Optional[str],
) -> None:
    rec = ai_result.get("recommendation", "HOLD")
    conf = ai_result.get("confidence", 0)

    title = f"AI Analysis: {ticker} → {rec} ({conf}% confidence)"
    message = ai_result.get("reasoning", "See app for full analysis.")

    notif = Notification(
        user_id=user_id,
        ticker=ticker,
        type="ai_recommendation",
        title=title,
        message=message,
    )
    db.add(notif)
    db.flush()

    if telegram_chat_id:
        tg_text = format_recommendation_message(ticker, ai_result, current_price)
        sent = send_telegram_sync(telegram_chat_id, tg_text)
        notif.telegram_sent = sent

    db.commit()


def send_daily_summary(
    db: Session,
    user_id: int,
    date_str: str,
    macro_regime: Optional[dict],
    sections: list,
    telegram_chat_id: Optional[str],
) -> None:
    """Persist one digest Notification row per user per EOD scan and push to Telegram."""
    text = format_daily_summary(date_str, macro_regime, sections)
    notif = Notification(
        user_id=user_id,
        ticker="*",
        type="daily_summary",
        title=f"Daily summary — {date_str}",
        message=text,
    )
    db.add(notif)
    db.flush()
    if telegram_chat_id:
        sent = send_telegram_sync(telegram_chat_id, text)
        notif.telegram_sent = sent
    db.commit()
