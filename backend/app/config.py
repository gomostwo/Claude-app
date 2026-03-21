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
