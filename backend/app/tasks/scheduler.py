from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
import pytz
import logging

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler(timezone=pytz.utc)


def run_scheduled_scan():
    """
    Scheduled scan: analyze each user's watchlist, check alerts, send Telegram notifications.
    Runs every 15 minutes during US market hours (Mon-Fri 09:30-16:00 ET).
    """
    from ..database import SessionLocal
    from ..models.user import User
    from ..models.watchlist import WatchlistItem
    from ..services.stock_data import get_current_quote
    from ..services.technical_analysis import compute_technical_indicators, run_screener
    from ..services.fundamental_analysis import compute_fundamental_data
    from ..services.ai_analysis import run_ai_analysis
    from ..services.notification_service import (
        check_price_alerts,
        check_rsi_alerts,
        send_ai_recommendation_notification,
    )
    from ..services.data_ingestion import ingest_ticker, get_latest_multi_provider
    from ..services.stock_data import COMMODITY_TICKERS
    from ..services import commodity_signals
    from ..services.ai.router import AIRequest, run as ai_run, should_promote_to_t2, should_promote_to_t3

    logger.info(f"[Scheduler] Starting market scan at {datetime.utcnow().isoformat()}")
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712

        for user in users:
            items = db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id).all()
            if not items:
                continue

            user_profile = {
                "budget": user.budget,
                "investment_style": user.investment_style,
                "time_horizon": user.time_horizon,
                "risk_tolerance": user.risk_tolerance,
            }

            for item in items:
                try:
                    ticker = item.ticker
                    # Multi-provider ingest — stores raw rows per provider
                    try:
                        ingest_ticker(db, ticker)
                    except Exception as ing_err:
                        logger.error(f"[Scheduler] ingest_ticker failed for {ticker}: {ing_err}")

                    quote = get_current_quote(ticker)
                    technical = compute_technical_indicators(ticker)

                    current_price = quote.get("price") if quote else None

                    # Price alerts
                    if current_price:
                        check_price_alerts(db, user.id, item, current_price, user.telegram_chat_id)

                    # RSI alerts
                    if technical and technical.get("rsi") is not None:
                        check_rsi_alerts(db, user.id, item, technical["rsi"], user.telegram_chat_id)

                    is_commodity = ticker in COMMODITY_TICKERS
                    multi_provider = get_latest_multi_provider(db, ticker)
                    cs_snapshot = commodity_signals.commodity_score(db, ticker) if is_commodity else None

                    # ── Tier 1: cheap screener (DeepSeek) ──────────────────
                    base_req = AIRequest(
                        ticker=ticker,
                        technical=technical,
                        multi_provider=multi_provider,
                        commodity_signals=cs_snapshot,
                        user_profile=user_profile,
                    )
                    t1 = ai_run(base_req, tier="t1") if is_commodity else None
                    promote_t2, reasons_t2 = should_promote_to_t2(
                        tier1_result=t1,
                        technical=technical,
                        commodity_signals=cs_snapshot,
                        multi_provider=multi_provider,
                    )
                    # Non-commodity tickers still fall back to the legacy rule-based screener
                    if not is_commodity:
                        promote_t2 = bool(run_screener(ticker))
                        reasons_t2 = ["legacy screener hit"] if promote_t2 else []

                    if not promote_t2:
                        continue

                    logger.info(f"[Scheduler] {ticker} → Tier2 ({', '.join(reasons_t2)})")

                    # ── Tier 2: Haiku analysis ─────────────────────────────
                    fundamental = compute_fundamental_data(ticker)
                    t2_req = AIRequest(
                        ticker=ticker,
                        technical=technical,
                        fundamental=fundamental,
                        multi_provider=multi_provider,
                        commodity_signals=cs_snapshot,
                        user_profile=user_profile,
                        purpose="analysis",
                    )
                    t2 = ai_run(t2_req, tier="t2")
                    if not t2:
                        continue

                    # ── Tier 3 gate ────────────────────────────────────────
                    # Risk pre-check stub returns True until PR6 lands.
                    promote_t3, reasons_t3 = should_promote_to_t3(
                        tier2_result=t2,
                        risk_precheck_ok=True,
                    )
                    if not promote_t3:
                        logger.info(f"[Scheduler] {ticker} → Tier2 stops ({', '.join(reasons_t3)})")
                        # Tier 2 verdict still useful for notification, even if not commit-grade
                        send_ai_recommendation_notification(
                            db, user.id, ticker, t2, current_price, user.telegram_chat_id
                        )
                        continue

                    logger.info(f"[Scheduler] {ticker} → Tier3")
                    ai_result = run_ai_analysis(
                        ticker, technical, fundamental, user_profile,
                        multi_provider=multi_provider,
                        commodity_signals_snapshot=cs_snapshot,
                    )
                    if ai_result:
                        send_ai_recommendation_notification(
                            db, user.id, ticker, ai_result, current_price, user.telegram_chat_id
                        )

                except Exception as e:
                    logger.error(f"[Scheduler] Error processing {item.ticker} for user {user.id}: {e}")
                    continue

    except Exception as e:
        logger.error(f"[Scheduler] Fatal scan error: {e}")
    finally:
        db.close()

    logger.info("[Scheduler] Scan complete")


def refresh_universe():
    """Daily job: refresh the stock universe cache."""
    from ..utils.cache import universe_cache
    universe_cache.delete("universe")
    from ..services.stock_data import get_universe
    get_universe()
    logger.info("[Scheduler] Universe cache refreshed")


def start_scheduler():
    if not scheduler.running:
        # Market scan: every 15 min, Mon-Fri, 09:30-16:15 ET (14:30-21:15 UTC)
        scheduler.add_job(
            run_scheduled_scan,
            CronTrigger(
                day_of_week="mon-fri",
                hour="14-21",
                minute="0,15,30,45",
                timezone=pytz.utc,
            ),
            id="market_scan",
            replace_existing=True,
            misfire_grace_time=300,
        )
        # Daily universe refresh at midnight UTC
        scheduler.add_job(
            refresh_universe,
            CronTrigger(hour=0, minute=0),
            id="universe_refresh",
            replace_existing=True,
        )
        scheduler.start()
        logger.info("[Scheduler] Started")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[Scheduler] Stopped")
