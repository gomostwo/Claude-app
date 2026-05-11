from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # App
    app_name: str = "Stock Analysis App"
    debug: bool = False
    secret_key: str = "change-me-in-production-use-long-random-string"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours

    # Database
    database_url: str = "sqlite:///./data/stocks.db"

    # Anthropic / Claude
    anthropic_api_key: str = ""

    # Telegram
    telegram_bot_token: str = ""

    # Market data providers (all optional — yfinance works without keys)
    finnhub_api_key: str = ""
    twelvedata_api_key: str = ""
    fmp_api_key: str = ""
    alphavantage_api_key: str = ""

    # Provider request throttling (seconds between calls per provider)
    finnhub_throttle: float = 1.0       # free: 60 req/min
    twelvedata_throttle: float = 7.5    # free: 8 req/min
    fmp_throttle: float = 0.35          # free: 250/day, ~3/s safe
    alphavantage_throttle: float = 13.0 # free: 5 req/min

    # Analysis schedule (minutes between scans during market hours)
    scan_interval_minutes: int = 15

    # Cache TTLs (seconds)
    technical_cache_ttl: int = 300      # 5 min
    fundamental_cache_ttl: int = 3600   # 1 hour
    ai_cache_ttl: int = 900             # 15 min
    universe_cache_ttl: int = 86400     # 24 hours

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
