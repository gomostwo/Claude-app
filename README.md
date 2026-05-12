# 📈 StockAI — AI-Powered Stock & Commodity Analysis

A full-stack app that monitors **all US stocks (S&P 500 + NASDAQ 100 + Dow 30)** and **commodities (Gold, Silver, Oil, Natural Gas)**, runs technical + fundamental analysis, and delivers **personalized AI recommendations via Telegram**.

## Features

- **Stock + commodity-ETF coverage** — S&P 500 + NASDAQ 100 + Dow 30 stocks, plus US commodity ETFs **GLD, SLV, USO, BNO, UNG, DBC** (tradeable through Webull Thailand's US stocks segment)
- **Multi-provider data ingestion** — yfinance + Finnhub + Twelve Data + FMP + Alpha Vantage. Each provider's quote and fundamentals stored separately for AI cross-validation
- **Commodity-specific signals** — EIA (oil/gas official prices), FRED (DXY, real yields, inflation breakevens), CFTC COT (managed-money positioning); composite commodity_score with drivers
- **Tiered AI router** — DeepSeek V3 screens 600+ tickers cheaply → Claude Haiku 4.5 analyzes promoted candidates → Claude Sonnet 4.6 produces commit-grade recommendations only on actionable, risk-approved candidates. Anthropic prompt caching cuts cost ~85%
- **Paper trading** — Full broker simulation with realistic slippage; fills persisted to DB
- **Risk management** — Deterministic kill switch, position cap, correlation cap across commodity groups; every order — paper or live — passes through identical invariants
- **Backtester** — Daily-bar replay using the same signal + risk + paper-broker code as live
- **Webull broker scaffold** — adapter slot in place, kept disabled (NotImplementedError) until OpenAPI key is confirmed and `LIVE_TRADING_ENABLED=true` is set
- **Telegram notifications** — Price thresholds, RSI signals, AI recommendations
- **Scheduled scans** — Every 15 min during US market hours (Mon–Fri 09:30–16:00 ET)

## Quick Start

### 1. Prerequisites
- Docker + Docker Compose
- Anthropic API key — [get one here](https://console.anthropic.com/)
- Telegram Bot Token — create via [@BotFather](https://t.me/BotFather)

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your API keys
nano .env
```

Required values in `.env`:
```env
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=123456:ABC...
SECRET_KEY=your-long-random-secret
```

Optional market data providers (all free tiers; yfinance works without keys):
```env
FINNHUB_API_KEY=         # https://finnhub.io/register        — 60 req/min
TWELVEDATA_API_KEY=      # https://twelvedata.com/pricing      — 800 req/day
FMP_API_KEY=             # https://site.financialmodelingprep.com/developer — 250 req/day
ALPHAVANTAGE_API_KEY=    # https://www.alphavantage.co/support/#api-key     — 25 req/day
```

Optional commodity-specific data (free official US gov't sources):
```env
EIA_API_KEY=             # https://www.eia.gov/opendata/register.php      — oil/gas spot prices
FRED_API_KEY=            # https://fred.stlouisfed.org/docs/api/api_key.html — DXY, real yields, inflation
# CFTC COT data is public CSV — no key required
```

Tier 1 AI screener (ultra-cheap fan-out):
```env
DEEPSEEK_API_KEY=        # https://platform.deepseek.com/api_keys
```

Webull broker (NOT yet wired — apply for OpenAPI access; setting the
keys alone will NOT enable live trading):
```env
WEBULL_APP_KEY=
WEBULL_APP_SECRET=
LIVE_TRADING_ENABLED=false   # keep false until OpenAPI is wired in a future PR
```

### 3. Start the app
```bash
docker compose up --build -d
```

Open **http://localhost** in your browser.

### 4. Get your Telegram Chat ID
1. Search for your bot in Telegram
2. Send `/start`
3. Visit: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Copy the `chat.id` from the response
5. Paste it in your Profile page → **Telegram Chat ID**

## Architecture

```
nginx (port 80)
├── /api/* → FastAPI backend (port 8000)
│   ├── Auth (JWT)
│   ├── User profiles + preferences
│   ├── Stock data (yfinance)
│   ├── Technical analysis (pandas-ta)
│   ├── Fundamental analysis
│   ├── AI analysis (Claude API)
│   ├── Watchlist management
│   ├── Notifications
│   └── APScheduler (auto-scan every 15 min)
└── /* → React frontend (port 80)
```

## Deployment (VPS)

```bash
# On your server
git clone <repo> && cd Claude-app
cp .env.example .env && nano .env
docker compose up --build -d

# Check logs
docker compose logs -f backend
```

For HTTPS, add Certbot/nginx SSL on top.

## Asset Coverage

| Category | Tickers |
|---|---|
| US Stocks | S&P 500 + NASDAQ 100 + Dow 30 (~600 unique) |
| Gold | GC=F |
| Silver | SI=F |
| WTI Oil | CL=F |
| Brent Oil | BZ=F |
| Natural Gas | NG=F |

## Tech Stack

### Backend
- **Language & Runtime**: Python 3.11
- **Framework**: FastAPI 0.111 + Uvicorn (ASGI server)
- **Database**: SQLite via SQLAlchemy 2.0 ORM, Alembic for migrations
- **Validation**: Pydantic 2 + pydantic-settings
- **Auth**: JWT (python-jose) + bcrypt password hashing (passlib)
- **HTTP Client**: httpx

### Data & Analysis
- **Market Data (multi-provider)**:
  - yfinance — always-on baseline (no key)
  - Finnhub — 60 req/min free, real-time US quotes
  - Twelve Data — 800 req/day free, strong commodities coverage
  - FMP — 250 req/day free, deep fundamentals
  - Alpha Vantage — 25 req/day free, commodity time-series
- **Storage Model**: each provider's quote + fundamentals stored separately (`provider_quotes`, `provider_fundamentals`) so AI sees all sources for cross-validation
- **Data Processing**: pandas 2.2, NumPy 1.26
- **Technical Indicators**: pandas-ta (RSI, MACD, Bollinger Bands, SMA/EMA)
- **HTML/XML Parsing**: lxml, html5lib, BeautifulSoup4
- **Caching**: cachetools
- **Timezones**: pytz

### AI & Notifications
- **LLM**: Anthropic Claude (`claude-sonnet-4-6`) via official `anthropic` SDK
- **Messaging**: python-telegram-bot 21
- **Scheduling**: APScheduler (15-min scans during US market hours)

### Frontend
- **Framework**: React 18 + TypeScript 5
- **State Management**: Redux Toolkit + React-Redux
- **Routing**: React Router 6
- **HTTP Client**: Axios
- **Charts**: Recharts
- **Notifications/Toasts**: react-toastify
- **Build Tooling**: react-scripts (CRA)

### Infrastructure
- **Reverse Proxy**: nginx (port 80, routes `/api/*` → backend, `/*` → frontend)
- **Containerization**: Docker + Docker Compose
