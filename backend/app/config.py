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

    # Tiered AI router — Tier 1 fans out cheaply, Tier 2/3 deepen on candidates
    ai_tier1_model: str = "deepseek-chat"          # cheap screener (DeepSeek V3)
    ai_tier2_model: str = "claude-haiku-4-5"       # analysis tier
    ai_tier3_model: str = "claude-sonnet-4-6"      # commit-grade recommendations
    deepseek_api_key: str = ""                     # required for Tier 1

    # Telegram
    telegram_bot_token: str = ""

    # Market data providers (all optional — yfinance works without keys)
    finnhub_api_key: str = ""
    twelvedata_api_key: str = ""
    fmp_api_key: str = ""
    alphavantage_api_key: str = ""

    # Commodity-specific data providers (free official sources)
    eia_api_key: str = ""              # https://www.eia.gov/opendata/register.php
    fred_api_key: str = ""             # https://fred.stlouisfed.org/docs/api/api_key.html
    # CFTC COT data is public CSV — no key required

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

    # Trading + risk management
    paper_trading_enabled: bool = True
    paper_autotrade_enabled: bool = False   # when True, scheduler executes Tier-3 BUY/SELL on paper
    live_trading_enabled: bool = False      # HARD off — second guard prevents WebullBroker live
    paper_starting_cash: float = 100_000.0  # USD seed for new paper accounts
    max_position_pct: float = 0.10          # any single position <= 10% of equity
    correlation_cap: float = 0.25           # any commodity-group bucket <= 25% of equity
    daily_loss_kill_pct: float = 0.03       # kill switch trips at -3% intraday
    slippage_bps: int = 5                   # paper broker fill slippage (basis points)
    quote_max_staleness_seconds: int = 300  # reject orders if quote older than this

    # Webull (scaffolded; not used until PR10)
    webull_app_key: str = ""
    webull_app_secret: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
