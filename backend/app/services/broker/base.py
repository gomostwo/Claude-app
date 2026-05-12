"""Broker abstraction — every concrete broker implements this Protocol."""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Protocol, List, Literal


Side = Literal["buy", "sell"]
OrderType = Literal["market", "limit"]
OrderStatus = Literal["pending", "filled", "rejected", "cancelled"]


@dataclass
class AccountSnapshot:
    cash: float
    equity: float           # cash + sum(position market value)
    buying_power: float
    mode: str               # "paper" | "live"


@dataclass
class PositionSnapshot:
    ticker: str
    qty: float
    avg_cost: float
    market_value: Optional[float] = None  # filled by broker if quote available


@dataclass
class OrderRequest:
    user_id: int
    ticker: str
    side: Side
    qty: float
    type: OrderType = "market"
    limit_price: Optional[float] = None
    client_order_id: Optional[str] = None  # caller-supplied; broker requires for idempotency


@dataclass
class OrderResult:
    id: int                     # DB row id
    client_order_id: str
    status: OrderStatus
    filled_qty: float = 0.0
    filled_avg_price: Optional[float] = None
    reason_rejected: Optional[str] = None
    submitted_at: Optional[datetime] = None
    filled_at: Optional[datetime] = None


class BrokerAdapter(Protocol):
    """Interface every concrete broker implements."""

    name: str

    def enabled(self) -> bool: ...
    def supports_live(self) -> bool: ...
    def get_account(self, user_id: int) -> AccountSnapshot: ...
    def list_positions(self, user_id: int) -> List[PositionSnapshot]: ...
    def place_order(self, req: OrderRequest) -> OrderResult: ...
    def cancel_order(self, user_id: int, broker_order_id: str) -> bool: ...
