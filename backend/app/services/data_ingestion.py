"""Multi-provider ingestion service.

Fetches quotes (and optionally fundamentals) from every enabled provider
for a given ticker, persisting one row per provider so AI analysis can
see all sources side-by-side.
"""
import json
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from ..models import ProviderQuote, ProviderFundamental
from .providers import enabled_providers
from .stock_data import COMMODITY_TICKERS


def _safe_raw(payload) -> str:
    try:
        return json.dumps(payload, default=str)[:50_000]
    except Exception:
        return "{}"


def ingest_ticker(
    db: Session,
    ticker: str,
    *,
    include_fundamentals: bool = True,
    asset_type: Optional[str] = None,
) -> dict:
    """Fetch from every enabled provider and persist. Returns summary."""
    asset_type = asset_type or ("commodity" if ticker in COMMODITY_TICKERS else "stock")
    is_commodity = asset_type == "commodity"
    summary = {"ticker": ticker, "quotes": {}, "fundamentals": {}}

    for provider in enabled_providers():
        # Quote
        try:
            q = provider.fetch_quote(ticker)
            row = ProviderQuote(
                provider=provider.name,
                ticker=ticker,
                asset_type=asset_type,
                price=q.get("price") if q else None,
                change=q.get("change") if q else None,
                change_percent=q.get("change_percent") if q else None,
                volume=q.get("volume") if q else None,
                raw_json=_safe_raw(q.get("raw") if q else {}),
                error=None if q else "no data",
            )
            db.add(row)
            summary["quotes"][provider.name] = {
                "price": row.price,
                "change_percent": row.change_percent,
                "error": row.error,
            }
        except Exception as e:
            db.add(ProviderQuote(
                provider=provider.name, ticker=ticker, asset_type=asset_type,
                raw_json="{}", error=str(e)[:200],
            ))
            summary["quotes"][provider.name] = {"error": str(e)[:200]}

        # Fundamentals (skip for commodities)
        if include_fundamentals and not is_commodity:
            try:
                f = provider.fetch_fundamentals(ticker)
                row = ProviderFundamental(
                    provider=provider.name,
                    ticker=ticker,
                    pe_ratio=f.get("pe_ratio") if f else None,
                    forward_pe=f.get("forward_pe") if f else None,
                    eps=f.get("eps") if f else None,
                    revenue_growth=f.get("revenue_growth") if f else None,
                    profit_margin=f.get("profit_margin") if f else None,
                    debt_to_equity=f.get("debt_to_equity") if f else None,
                    dividend_yield=f.get("dividend_yield") if f else None,
                    beta=f.get("beta") if f else None,
                    market_cap=f.get("market_cap") if f else None,
                    sector=f.get("sector") if f else None,
                    industry=f.get("industry") if f else None,
                    raw_json=_safe_raw(f.get("raw") if f else {}),
                    error=None if f else "no data",
                )
                db.add(row)
                summary["fundamentals"][provider.name] = {
                    "pe_ratio": row.pe_ratio,
                    "error": row.error,
                }
            except Exception as e:
                db.add(ProviderFundamental(
                    provider=provider.name, ticker=ticker,
                    raw_json="{}", error=str(e)[:200],
                ))
                summary["fundamentals"][provider.name] = {"error": str(e)[:200]}

    db.commit()
    return summary


def get_latest_multi_provider(db: Session, ticker: str, max_age_minutes: int = 30) -> dict:
    """Return latest stored quote + fundamental rows per provider for AI consumption."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)

    quotes = (
        db.query(ProviderQuote)
        .filter(ProviderQuote.ticker == ticker, ProviderQuote.fetched_at >= cutoff)
        .order_by(ProviderQuote.fetched_at.desc())
        .all()
    )
    latest_quotes = {}
    for q in quotes:
        if q.provider not in latest_quotes:
            latest_quotes[q.provider] = {
                "price": q.price,
                "change": q.change,
                "change_percent": q.change_percent,
                "volume": q.volume,
                "fetched_at": q.fetched_at.isoformat() if q.fetched_at else None,
                "error": q.error,
            }

    funds = (
        db.query(ProviderFundamental)
        .filter(ProviderFundamental.ticker == ticker)
        .order_by(ProviderFundamental.fetched_at.desc())
        .all()
    )
    latest_funds = {}
    for f in funds:
        if f.provider not in latest_funds:
            latest_funds[f.provider] = {
                "pe_ratio": f.pe_ratio,
                "forward_pe": f.forward_pe,
                "eps": f.eps,
                "revenue_growth": f.revenue_growth,
                "profit_margin": f.profit_margin,
                "debt_to_equity": f.debt_to_equity,
                "dividend_yield": f.dividend_yield,
                "beta": f.beta,
                "market_cap": f.market_cap,
                "sector": f.sector,
                "industry": f.industry,
                "fetched_at": f.fetched_at.isoformat() if f.fetched_at else None,
                "error": f.error,
            }

    return {"ticker": ticker, "quotes": latest_quotes, "fundamentals": latest_funds}
