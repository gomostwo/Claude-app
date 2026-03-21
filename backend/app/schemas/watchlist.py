from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class WatchlistItemCreate(BaseModel):
    ticker: str
    alert_price_above: Optional[float] = None
    alert_price_below: Optional[float] = None
    alert_rsi_overbought: bool = False
    alert_rsi_oversold: bool = False


class WatchlistItemUpdate(BaseModel):
    alert_price_above: Optional[float] = None
    alert_price_below: Optional[float] = None
    alert_rsi_overbought: Optional[bool] = None
    alert_rsi_oversold: Optional[bool] = None


class WatchlistItemResponse(BaseModel):
    id: int
    ticker: str
    company_name: Optional[str]
    asset_type: str
    added_at: datetime
    alert_price_above: Optional[float]
    alert_price_below: Optional[float]
    alert_rsi_overbought: bool
    alert_rsi_oversold: bool

    class Config:
        from_attributes = True
