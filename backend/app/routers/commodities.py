from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..utils.auth import get_current_user
from ..services.stock_data import COMMODITY_TICKERS
from ..services import commodity_signals

router = APIRouter(prefix="/api/commodities", tags=["commodities"])


@router.get("/regime")
def get_macro_regime(current_user: User = Depends(get_current_user)):
    """Current commodity-relevant macro regime (USD trend, real yields, inflation)."""
    regime = commodity_signals.macro_regime()
    if not regime:
        raise HTTPException(status_code=503, detail="Macro regime unavailable (configure FRED_API_KEY)")
    return regime


@router.get("/{ticker}/signals")
def get_ticker_signals(
    ticker: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Term structure, COT positioning, macro regime, ETF flow, and composite score for a commodity ETF."""
    ticker = ticker.upper()
    if ticker not in COMMODITY_TICKERS:
        raise HTTPException(
            status_code=400,
            detail=f"{ticker} is not in the commodity universe ({list(COMMODITY_TICKERS.keys())})",
        )
    return commodity_signals.commodity_score(db, ticker)


@router.get("/universe")
def get_commodity_universe(current_user: User = Depends(get_current_user)):
    """List the commodity ETFs the system is configured to analyze."""
    from ..services.stock_data import COMMODITY_GROUPS
    return {
        "tickers": COMMODITY_TICKERS,
        "groups": COMMODITY_GROUPS,
    }
