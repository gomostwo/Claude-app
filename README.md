# 📈 StockAI — AI-Powered Stock & Commodity Analysis

A full-stack app that monitors **all US stocks (S&P 500 + NASDAQ 100 + Dow 30)** and **commodities (Gold, Silver, Oil, Natural Gas)**, runs technical + fundamental analysis, and delivers **personalized AI recommendations via Telegram**.

## Features

- **Real-time monitoring** — Tracks S&P 500, NASDAQ 100, Dow 30 + Gold (GC=F), Silver (SI=F), WTI Oil (CL=F), Brent Oil (BZ=F), Natural Gas (NG=F)
- **Technical analysis** — RSI, MACD, Bollinger Bands, SMA/EMA (20/50/200), volume analysis
- **Fundamental analysis** — P/E, EPS, D/E ratio, revenue growth, profit margin, beta (stocks only)
- **AI recommendations** — Claude claude-sonnet-4-6 generates personalized BUY/SELL/HOLD with reasoning
- **Smart screener** — Rule-based pre-filter (RSI extremes, MACD crossover, SMA cross, volume spike)
- **Telegram notifications** — Instant alerts for price thresholds, RSI signals, AI recommendations
- **User profiles** — Budget, investment style, time horizon, risk tolerance saved and used by AI
- **Scheduled scans** — Auto-runs every 15 min during US market hours (Mon–Fri 9:30–16:00 ET)
- **Manual analysis** — Trigger analysis on any ticker instantly

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
- **Market Data**: yfinance (Yahoo Finance — free)
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
