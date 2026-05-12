"""Webull broker scaffold.

This adapter intentionally does **not** call the Webull OpenAPI. Every
method raises NotImplementedError with a clear, distinct message so
callers can surface a useful error.

Defense in depth: registry.get_broker("webull", ...) already refuses
to instantiate this class unless settings.live_trading_enabled=True.
This module enforces a *second* guard inside __init__ so even if a
caller bypasses the registry, the class still raises before doing
anything.

Wiring real Webull OpenAPI calls will happen in a separate PR after
the user confirms they hold a working WEBULL_APP_KEY/SECRET pair.
"""
from typing import List
from sqlalchemy.orm import Session

from ...config import settings
from .base import BrokerAdapter, AccountSnapshot, PositionSnapshot, OrderRequest, OrderResult


_DISABLED_MSG = (
    "Webull broker not implemented. Live trading requires both "
    "settings.live_trading_enabled=True AND a separate PR wiring the Webull "
    "OpenAPI. Currently {live} / {key}."
)


def _disabled_detail() -> str:
    return _DISABLED_MSG.format(
        live="live_trading_enabled=True" if settings.live_trading_enabled else "live_trading_enabled=False",
        key="WEBULL_APP_KEY set" if settings.webull_app_key else "WEBULL_APP_KEY missing",
    )


class WebullBroker:
    name = "webull"

    def __init__(self, db: Session):
        # Second hard guard. If anything bypasses registry.get_broker, fail here.
        if not settings.live_trading_enabled:
            raise PermissionError(
                "WebullBroker constructed while settings.live_trading_enabled=False"
            )
        self.db = db

    def enabled(self) -> bool:
        return bool(settings.webull_app_key and settings.webull_app_secret)

    def supports_live(self) -> bool:
        return True

    def get_account(self, user_id: int) -> AccountSnapshot:
        raise NotImplementedError(_disabled_detail())

    def list_positions(self, user_id: int) -> List[PositionSnapshot]:
        raise NotImplementedError(_disabled_detail())

    def place_order(self, req: OrderRequest) -> OrderResult:
        raise NotImplementedError(_disabled_detail())

    def cancel_order(self, user_id: int, broker_order_id: str) -> bool:
        raise NotImplementedError(_disabled_detail())
