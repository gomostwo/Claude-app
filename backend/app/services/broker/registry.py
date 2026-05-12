"""Broker factory. Returns a concrete BrokerAdapter for the requested mode.

Hard guard: refuses to instantiate any live broker when
`settings.live_trading_enabled == False` regardless of caller intent.
"""
from typing import Literal
from sqlalchemy.orm import Session
from ...config import settings
from .paper_broker import PaperBroker
from .base import BrokerAdapter


BrokerMode = Literal["paper", "alpaca", "webull"]


def get_broker(mode: BrokerMode, db: Session) -> BrokerAdapter:
    if mode == "paper":
        return PaperBroker(db)
    if mode == "alpaca":
        if not settings.alpaca_api_key:
            raise ValueError("ALPACA_API_KEY not set — configure it in .env")
        from .alpaca_broker import AlpacaBroker
        return AlpacaBroker(db)
    if mode == "webull":
        if not settings.live_trading_enabled:
            raise PermissionError(
                "Webull broker disabled: settings.live_trading_enabled=False"
            )
        from .webull_broker import WebullBroker
        return WebullBroker(db)
    raise ValueError(f"unknown broker mode: {mode}")
