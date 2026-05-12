"""Trading endpoints — paper trading is fully functional; live trading
returns 501 NotImplementedError until WebullBroker is wired and
live_trading_enabled is set to True.
"""
from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..models import Order as OrderRow, RiskState
from ..utils.auth import get_current_user
from ..services.broker.registry import get_broker
from ..services.broker.base import OrderRequest

router = APIRouter(prefix="/api/trading", tags=["trading"])


# ── Pydantic IO models ────────────────────────────────────────────────────

class PositionOut(BaseModel):
    ticker: str
    qty: float
    avg_cost: float
    market_value: Optional[float] = None


class AccountOut(BaseModel):
    cash: float
    equity: float
    buying_power: float
    mode: str


class OrderIn(BaseModel):
    ticker: str
    side: Literal["buy", "sell"]
    qty: float = Field(gt=0)
    type: Literal["market", "limit"] = "market"
    limit_price: Optional[float] = None
    client_order_id: Optional[str] = None
    mode: Literal["paper", "webull"] = "paper"


class OrderOut(BaseModel):
    id: int
    client_order_id: str
    ticker: str
    side: str
    qty: float
    type: str
    limit_price: Optional[float]
    status: str
    filled_qty: float
    filled_avg_price: Optional[float]
    reason_rejected: Optional[str]


class KillSwitchIn(BaseModel):
    active: bool
    reason: Optional[str] = None
    mode: Literal["paper", "webull"] = "paper"


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("/account/{mode}", response_model=AccountOut)
def get_account(
    mode: Literal["paper", "webull"],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    broker = get_broker(mode, db)
    snap = broker.get_account(current_user.id)
    return AccountOut(cash=snap.cash, equity=snap.equity, buying_power=snap.buying_power, mode=snap.mode)


@router.get("/positions/{mode}", response_model=List[PositionOut])
def list_positions(
    mode: Literal["paper", "webull"],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    broker = get_broker(mode, db)
    return [
        PositionOut(ticker=p.ticker, qty=p.qty, avg_cost=p.avg_cost, market_value=p.market_value)
        for p in broker.list_positions(current_user.id)
    ]


@router.get("/orders/{mode}", response_model=List[OrderOut])
def list_orders(
    mode: Literal["paper", "webull"],
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(OrderRow)
        .filter(OrderRow.user_id == current_user.id, OrderRow.mode == mode)
        .order_by(OrderRow.submitted_at.desc())
        .limit(limit)
        .all()
    )
    return [
        OrderOut(
            id=r.id, client_order_id=r.client_order_id, ticker=r.ticker,
            side=r.side, qty=r.qty, type=r.type, limit_price=r.limit_price,
            status=r.status, filled_qty=r.filled_qty,
            filled_avg_price=r.filled_avg_price, reason_rejected=r.reason_rejected,
        )
        for r in rows
    ]


@router.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def submit_order(
    data: OrderIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        broker = get_broker(data.mode, db)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))

    req = OrderRequest(
        user_id=current_user.id,
        ticker=data.ticker.upper(),
        side=data.side,
        qty=data.qty,
        type=data.type,
        limit_price=data.limit_price,
        client_order_id=data.client_order_id,
    )
    try:
        result = broker.place_order(req)
    except NotImplementedError as e:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(e))

    if result.status == "rejected":
        # Surface risk reasons as 400 instead of 201
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": result.reason_rejected, "order_id": result.id},
        )

    row = db.query(OrderRow).filter(OrderRow.id == result.id).first()
    return OrderOut(
        id=row.id, client_order_id=row.client_order_id, ticker=row.ticker,
        side=row.side, qty=row.qty, type=row.type, limit_price=row.limit_price,
        status=row.status, filled_qty=row.filled_qty,
        filled_avg_price=row.filled_avg_price, reason_rejected=row.reason_rejected,
    )


@router.post("/kill-switch")
def set_kill_switch(
    data: KillSwitchIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rs = (
        db.query(RiskState)
        .filter(RiskState.user_id == current_user.id, RiskState.mode == data.mode)
        .first()
    )
    if rs is None:
        rs = RiskState(user_id=current_user.id, mode=data.mode)
        db.add(rs)
    rs.kill_switch_active = data.active
    rs.kill_switch_reason = data.reason if data.active else None
    db.commit()
    db.refresh(rs)
    return {
        "mode": rs.mode,
        "kill_switch_active": rs.kill_switch_active,
        "kill_switch_reason": rs.kill_switch_reason,
    }


@router.get("/kill-switch/{mode}")
def get_kill_switch(
    mode: Literal["paper", "webull"],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rs = (
        db.query(RiskState)
        .filter(RiskState.user_id == current_user.id, RiskState.mode == mode)
        .first()
    )
    if rs is None:
        return {"mode": mode, "kill_switch_active": False, "kill_switch_reason": None}
    return {
        "mode": rs.mode,
        "kill_switch_active": rs.kill_switch_active,
        "kill_switch_reason": rs.kill_switch_reason,
    }
