from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserProfileUpdate(BaseModel):
    budget: Optional[float] = None
    investment_style: Optional[str] = None   # growth/value/dividend/speculative
    time_horizon: Optional[str] = None       # short/medium/long
    risk_tolerance: Optional[str] = None     # conservative/moderate/aggressive
    telegram_chat_id: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    is_active: bool
    budget: Optional[float]
    investment_style: Optional[str]
    time_horizon: Optional[str]
    risk_tolerance: Optional[str]
    telegram_chat_id: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
