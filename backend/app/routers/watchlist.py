from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models.user import User
from ..models.watchlist import WatchlistItem
from ..schemas.watchlist import WatchlistItemCreate, WatchlistItemUpdate, WatchlistItemResponse
from ..utils.auth import get_current_user
from ..services.stock_data import get_stock_info

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


@router.get("", response_model=List[WatchlistItemResponse])
def get_watchlist(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(WatchlistItem).filter(WatchlistItem.user_id == current_user.id).all()


@router.post("", response_model=WatchlistItemResponse, status_code=status.HTTP_201_CREATED)
def add_to_watchlist(
    data: WatchlistItemCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = db.query(WatchlistItem).filter(
        WatchlistItem.user_id == current_user.id,
        WatchlistItem.ticker == data.ticker.upper(),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ticker already in watchlist")

    # Lookup company name and asset type
    ticker_upper = data.ticker.upper()
    info = get_stock_info(ticker_upper)
    company_name = info.get("shortName") or info.get("longName") or ticker_upper
    asset_type = "commodity" if ticker_upper in _COMMODITY_TICKERS else "stock"

    item = WatchlistItem(
        user_id=current_user.id,
        ticker=ticker_upper,
        company_name=company_name,
        asset_type=asset_type,
        alert_price_above=data.alert_price_above,
        alert_price_below=data.alert_price_below,
        alert_rsi_overbought=data.alert_rsi_overbought,
        alert_rsi_oversold=data.alert_rsi_oversold,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}", response_model=WatchlistItemResponse)
def update_watchlist_item(
    item_id: int,
    data: WatchlistItemUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(WatchlistItem).filter(
        WatchlistItem.id == item_id,
        WatchlistItem.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_watchlist(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(WatchlistItem).filter(
        WatchlistItem.id == item_id,
        WatchlistItem.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    db.delete(item)
    db.commit()


_COMMODITY_TICKERS = {"GC=F", "SI=F", "CL=F", "BZ=F", "NG=F"}
