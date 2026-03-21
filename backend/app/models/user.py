from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Investment profile
    budget = Column(Float, nullable=True)
    investment_style = Column(String, nullable=True)   # growth/value/dividend/speculative
    time_horizon = Column(String, nullable=True)       # short/medium/long
    risk_tolerance = Column(String, nullable=True)     # conservative/moderate/aggressive
    telegram_chat_id = Column(String, nullable=True)

    # Relationships
    watchlist = relationship("WatchlistItem", back_populates="user", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
