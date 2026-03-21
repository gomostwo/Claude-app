from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from sqlalchemy.sql import func
from ..database import Base


class AnalysisCache(Base):
    __tablename__ = "analysis_cache"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, nullable=False)
    analysis_type = Column(String, nullable=False)  # technical / fundamental / ai
    user_profile_hash = Column(String, nullable=True)  # MD5 of user profile (for AI)
    result_json = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_cache_lookup", "ticker", "analysis_type", "expires_at"),
    )
