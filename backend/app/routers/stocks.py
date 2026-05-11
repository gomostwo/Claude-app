from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models.user import User
from ..schemas.stock import StockQuote, TechnicalData, FundamentalData, AIRecommendation, FullAnalysis, ScreenerResult
from ..utils.auth import get_current_user
from ..services.stock_data import get_current_quote, search_tickers, COMMODITY_TICKERS
from ..services.technical_analysis import compute_technical_indicators, run_screener
from ..services.fundamental_analysis import compute_fundamental_data
from ..services.ai_analysis import run_ai_analysis
from ..services.data_ingestion import ingest_ticker, get_latest_multi_provider
from ..services.providers import enabled_providers

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


@router.get("/providers")
def list_providers(current_user: User = Depends(get_current_user)):
    """Show which market data providers are configured."""
    return {"enabled": [p.name for p in enabled_providers()]}


@router.get("/{ticker}/multi-provider")
def get_multi_provider_view(
    ticker: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return latest stored quote + fundamental rows per provider."""
    return get_latest_multi_provider(db, ticker.upper())


@router.post("/{ticker}/ingest")
def trigger_ingest(
    ticker: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually fetch from all enabled providers and persist."""
    return ingest_ticker(db, ticker.upper())


@router.get("/search", response_model=List[dict])
def search_stocks(q: str, current_user: User = Depends(get_current_user)):
    if len(q) < 1:
        return []
    return search_tickers(q)


@router.get("/{ticker}/quote", response_model=StockQuote)
def get_quote(ticker: str, current_user: User = Depends(get_current_user)):
    ticker = ticker.upper()
    quote = get_current_quote(ticker)
    if not quote or quote.get("price") is None:
        raise HTTPException(status_code=404, detail=f"Quote not found for {ticker}")
    return quote


@router.get("/{ticker}/technical", response_model=TechnicalData)
def get_technical(ticker: str, current_user: User = Depends(get_current_user)):
    ticker = ticker.upper()
    data = compute_technical_indicators(ticker)
    if not data:
        raise HTTPException(status_code=404, detail=f"Technical data not available for {ticker}")
    return data


@router.get("/{ticker}/fundamental", response_model=Optional[FundamentalData])
def get_fundamental(ticker: str, current_user: User = Depends(get_current_user)):
    ticker = ticker.upper()
    if ticker in COMMODITY_TICKERS:
        return None
    data = compute_fundamental_data(ticker)
    if not data:
        raise HTTPException(status_code=404, detail=f"Fundamental data not available for {ticker}")
    return data


@router.post("/{ticker}/analyze", response_model=FullAnalysis)
def analyze_stock(
    ticker: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manual trigger: full analysis including AI recommendation."""
    ticker = ticker.upper()

    # Fresh multi-provider pull, then read back combined view for the AI
    try:
        ingest_ticker(db, ticker)
    except Exception:
        pass
    multi_provider = get_latest_multi_provider(db, ticker)

    quote = get_current_quote(ticker)
    technical = compute_technical_indicators(ticker)
    fundamental = compute_fundamental_data(ticker)

    if not technical:
        raise HTTPException(status_code=404, detail=f"Cannot analyze {ticker}: insufficient data")

    user_profile = {
        "budget": current_user.budget,
        "investment_style": current_user.investment_style,
        "time_horizon": current_user.time_horizon,
        "risk_tolerance": current_user.risk_tolerance,
    }

    ai_result = run_ai_analysis(
        ticker, technical, fundamental, user_profile,
        multi_provider=multi_provider,
    )

    return {
        "quote": quote,
        "technical": technical,
        "fundamental": fundamental,
        "ai_recommendation": ai_result,
    }


@router.get("/screener/scan", response_model=List[ScreenerResult])
def run_market_screener(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
):
    """Run rule-based screener across user's watchlist and return matches."""
    from ..database import SessionLocal
    from ..models.watchlist import WatchlistItem

    db = SessionLocal()
    try:
        items = db.query(WatchlistItem).filter(WatchlistItem.user_id == current_user.id).all()
    finally:
        db.close()

    results = []
    for item in items[:limit]:
        signals = run_screener(item.ticker)
        if signals:
            quote = get_current_quote(item.ticker)
            tech = compute_technical_indicators(item.ticker)
            results.append({
                "ticker": item.ticker,
                "company_name": item.company_name,
                "asset_type": item.asset_type,
                "price": quote.get("price") if quote else None,
                "rsi": tech.get("rsi") if tech else None,
                "signals": signals,
            })
    return results
