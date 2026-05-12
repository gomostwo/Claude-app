"""End-of-day scheduler.

Single daily run, Mon-Fri at 22:00 UTC — ≥1h after the US regular-session
close in either DST regime, which gives the daily candle time to settle on
yfinance and other providers. Per user we build ONE digest covering every
watchlist ticker and send a single Telegram summary.
"""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
import pytz
import logging

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler(timezone=pytz.utc)


def _maybe_paper_autotrade(db, user_id: int, ticker: str, ai_result: dict, current_price):
    """If paper_autotrade_enabled, route Tier-3 BUY/SELL → risk → broker.

    Broker selection: settings.auto_trade_broker
      "paper"  → in-DB PaperBroker (no external calls)
      "alpaca" → AlpacaBroker (Alpaca paper trading API, fills at next open)
    """
    from ..config import settings as _settings
    if not _settings.paper_autotrade_enabled:
        return
    rec = (ai_result.get("recommendation") or "").upper()
    if rec not in ("BUY", "SELL"):
        return
    if not current_price or current_price <= 0:
        return

    from ..services.broker.registry import get_broker
    from ..services.broker.base import OrderRequest
    import uuid

    broker_mode = _settings.auto_trade_broker  # "paper" or "alpaca"
    try:
        broker = get_broker(broker_mode, db)
    except Exception as e:
        logger.error(f"[Autotrade] cannot get broker '{broker_mode}': {e}")
        return

    account = broker.get_account(user_id)
    target_notional = account.equity * _settings.max_position_pct
    qty = int(target_notional / current_price)
    if qty <= 0:
        return

    side = "buy" if rec == "BUY" else "sell"
    if side == "sell":
        positions = {p.ticker: p.qty for p in broker.list_positions(user_id)}
        if positions.get(ticker, 0) <= 0:
            logger.info(f"[Autotrade] {ticker} SELL skipped: no long position")
            return
        qty = min(qty, int(positions[ticker]))
        if qty <= 0:
            return

    req = OrderRequest(
        user_id=user_id,
        ticker=ticker,
        side=side,
        qty=qty,
        type="market",
        client_order_id=f"auto-{ticker}-{uuid.uuid4().hex[:8]}",
    )
    result = broker.place_order(req)
    logger.info(
        f"[Autotrade] [{broker_mode}] {ticker} {side} {qty} "
        f"→ status={result.status} reason={result.reason_rejected or '—'}"
    )


def _day_change_pct(ticker: str):
    """Return today's percent change vs. previous daily close, or None."""
    try:
        import yfinance as yf
        hist = yf.Ticker(ticker).history(period="5d", interval="1d", auto_adjust=False)
        if hist is None or len(hist) < 2:
            return None
        last = float(hist["Close"].iloc[-1])
        prev = float(hist["Close"].iloc[-2])
        if prev <= 0:
            return None
        return (last - prev) / prev * 100.0
    except Exception:
        return None


def run_end_of_day_scan():
    """End-of-day analysis run. Fires once per trading day after the US close.

    Flow per user:
      1. Ingest fresh multi-provider quotes/fundamentals
      2. Compute technicals + (for ETFs) commodity signals
      3. Tier 1 (DeepSeek) → promote → Tier 2 (Haiku) → promote → Tier 3 (Sonnet)
      4. Collect every ticker's result into a digest dict
      5. Send ONE Telegram summary for the day
      6. If paper_autotrade_enabled: queue Tier-3 BUY/SELL via PaperBroker
    """
    from ..database import SessionLocal
    from ..models.user import User
    from ..models.watchlist import WatchlistItem
    from ..services.stock_data import get_current_quote, COMMODITY_TICKERS
    from ..services.technical_analysis import compute_technical_indicators, run_screener
    from ..services.fundamental_analysis import compute_fundamental_data
    from ..services.ai_analysis import run_ai_analysis
    from ..services.notification_service import send_daily_summary
    from ..services.data_ingestion import ingest_ticker, get_latest_multi_provider
    from ..services import commodity_signals
    from ..services.ai.router import AIRequest, run as ai_run, should_promote_to_t2, should_promote_to_t3

    now_utc = datetime.utcnow()
    date_str = now_utc.strftime("%Y-%m-%d")
    logger.info(f"[Scheduler] EOD scan starting at {now_utc.isoformat()}Z")

    try:
        macro_regime = commodity_signals.macro_regime()
    except Exception as e:
        logger.error(f"[Scheduler] macro_regime failed: {e}")
        macro_regime = None

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
            sections = []
            t1_hits = t2_hits = t3_hits = 0

            for item in items:
                ticker = item.ticker
                section = {"ticker": ticker, "alerts": []}
                try:
                    try:
                        ingest_ticker(db, ticker)
                    except Exception as ing_err:
                        logger.error(f"[Scheduler] ingest_ticker failed for {ticker}: {ing_err}")

                    quote = get_current_quote(ticker)
                    technical = compute_technical_indicators(ticker)
                    current_price = quote.get("price") if quote else None
                    section["price"] = current_price
                    section["day_change_pct"] = _day_change_pct(ticker)

                    rsi = technical.get("rsi") if technical else None
                    if current_price is not None:
                        if item.alert_price_above and current_price >= item.alert_price_above:
                            section["alerts"].append(
                                f"crossed above ${item.alert_price_above:,.2f}"
                            )
                        if item.alert_price_below and current_price <= item.alert_price_below:
                            section["alerts"].append(
                                f"dropped below ${item.alert_price_below:,.2f}"
                            )
                    if rsi is not None:
                        if item.alert_rsi_overbought and rsi > 70:
                            section["alerts"].append(f"RSI overbought ({rsi:.1f})")
                        if item.alert_rsi_oversold and rsi < 30:
                            section["alerts"].append(f"RSI oversold ({rsi:.1f})")

                    is_commodity = ticker in COMMODITY_TICKERS
                    multi_provider = get_latest_multi_provider(db, ticker)
                    cs_snapshot = commodity_signals.commodity_score(db, ticker) if is_commodity else None
                    if cs_snapshot:
                        section["commodity_score"] = int(cs_snapshot.get("score", 0))

                    base_req = AIRequest(
                        ticker=ticker,
                        technical=technical,
                        multi_provider=multi_provider,
                        commodity_signals=cs_snapshot,
                        user_profile=user_profile,
                    )

                    if is_commodity:
                        t1 = ai_run(base_req, tier="t1")
                        t1_hits += 1
                        promote_t2, reasons_t2 = should_promote_to_t2(
                            tier1_result=t1,
                            technical=technical,
                            commodity_signals=cs_snapshot,
                            multi_provider=multi_provider,
                        )
                        section["tier"] = "T1"
                        section["verdict"] = (t1 or {}).get("verdict", "skip")
                    else:
                        promote_t2 = bool(run_screener(ticker))
                        reasons_t2 = ["legacy screener hit"] if promote_t2 else []
                        section["tier"] = "T1"
                        section["verdict"] = "candidate" if promote_t2 else "skip"

                    if not promote_t2:
                        sections.append(section)
                        continue

                    logger.info(f"[Scheduler] {ticker} → Tier2 ({', '.join(reasons_t2)})")
                    t2_hits += 1
                    section["tier"] = "T2"

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
                        sections.append(section)
                        continue
                    section["verdict"] = t2.get("recommendation") or "HOLD"
                    section["confidence"] = t2.get("confidence")

                    promote_t3, reasons_t3 = should_promote_to_t3(
                        tier2_result=t2,
                        risk_precheck_ok=True,
                    )
                    if not promote_t3:
                        logger.info(f"[Scheduler] {ticker} → Tier2 stops ({', '.join(reasons_t3)})")
                        section["reasoning"] = t2.get("reasoning")
                        sections.append(section)
                        continue

                    logger.info(f"[Scheduler] {ticker} → Tier3")
                    t3_hits += 1
                    section["tier"] = "T3"
                    ai_result = run_ai_analysis(
                        ticker, technical, fundamental, user_profile,
                        multi_provider=multi_provider,
                        commodity_signals_snapshot=cs_snapshot,
                    )
                    if ai_result:
                        section["recommendation"] = (ai_result.get("recommendation") or "").upper() or None
                        section["confidence"] = ai_result.get("confidence")
                        section["reasoning"] = ai_result.get("reasoning")
                        section["target_price"] = ai_result.get("target_price")
                        _maybe_paper_autotrade(db, user.id, ticker, ai_result, current_price)

                    sections.append(section)

                except Exception as e:
                    logger.error(f"[Scheduler] Error processing {item.ticker} for user {user.id}: {e}")
                    section["alerts"].append(f"analysis error: {e}")
                    sections.append(section)
                    continue

            logger.info(
                f"[Scheduler] user={user.id} T1={t1_hits} T2={t2_hits} T3={t3_hits}"
            )
            try:
                send_daily_summary(
                    db, user.id, date_str, macro_regime, sections, user.telegram_chat_id
                )
            except Exception as e:
                logger.error(f"[Scheduler] send_daily_summary failed for user {user.id}: {e}")

    except Exception as e:
        logger.error(f"[Scheduler] Fatal EOD error: {e}")
    finally:
        db.close()

    logger.info("[Scheduler] EOD scan complete")


def refresh_universe():
    """Daily job: refresh the stock universe cache."""
    from ..utils.cache import universe_cache
    universe_cache.delete("universe")
    from ..services.stock_data import get_universe
    get_universe()
    logger.info("[Scheduler] Universe cache refreshed")


def start_scheduler():
    if not scheduler.running:
        # EOD market scan: once daily at 22:00 UTC, Mon-Fri.
        # US regular session closes at 20:00 UTC (EDT) / 21:00 UTC (EST).
        # 22:00 UTC handles both year-round and gives the daily candle time to settle.
        scheduler.add_job(
            run_end_of_day_scan,
            CronTrigger(
                day_of_week="mon-fri",
                hour=22,
                minute=0,
                timezone=pytz.utc,
            ),
            id="eod_scan",
            replace_existing=True,
            misfire_grace_time=3600,
        )
        # Daily universe refresh at midnight UTC
        scheduler.add_job(
            refresh_universe,
            CronTrigger(hour=0, minute=0),
            id="universe_refresh",
            replace_existing=True,
        )
        scheduler.start()
        logger.info("[Scheduler] Started (EOD mode: 22:00 UTC Mon-Fri)")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[Scheduler] Stopped")
