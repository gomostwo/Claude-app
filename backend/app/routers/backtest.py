"""Backtest endpoint."""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..models.user import User
from ..utils.auth import get_current_user
from ..services.stock_data import COMMODITY_TICKERS
from ..services import backtester

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


class BacktestIn(BaseModel):
    tickers: List[str] = Field(min_length=1)
    start: str = Field(description="YYYY-MM-DD")
    end: str = Field(description="YYYY-MM-DD")
    starting_cash: Optional[float] = None


@router.post("/run")
def run_backtest(data: BacktestIn, current_user: User = Depends(get_current_user)):
    tickers = [t.upper() for t in data.tickers]
    bad = [t for t in tickers if t not in COMMODITY_TICKERS]
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"Tickers {bad} not in commodity universe ({list(COMMODITY_TICKERS.keys())})",
        )
    report = backtester.run_backtest(
        tickers=tickers,
        start=data.start,
        end=data.end,
        starting_cash=data.starting_cash,
    )
    # dataclass → dict for FastAPI
    return {
        "tickers": report.tickers,
        "start": report.start,
        "end": report.end,
        "starting_equity": report.starting_equity,
        "ending_equity": report.ending_equity,
        "total_return_pct": report.total_return_pct,
        "cagr_pct": report.cagr_pct,
        "max_drawdown_pct": report.max_drawdown_pct,
        "sharpe": report.sharpe,
        "bars_processed": report.bars_processed,
        "trades": [t.__dict__ for t in report.trades],
        "simplifications": report.simplifications,
    }
