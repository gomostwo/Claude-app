from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class NotificationResponse(BaseModel):
    id: int
    ticker: Optional[str]
    type: str
    title: str
    message: str
    is_read: bool
    telegram_sent: bool
    created_at: datetime

    class Config:
        from_attributes = True
