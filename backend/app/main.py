from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from .database import init_db
from .tasks.scheduler import start_scheduler, stop_scheduler
from .routers import auth, users, stocks, watchlist, notifications, commodities, trading

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    init_db()
    logger.info("Starting scheduler...")
    start_scheduler()
    yield
    # Shutdown
    stop_scheduler()


app = FastAPI(
    title="Stock Analysis App",
    description="Real-time stock & commodity analysis with AI-powered recommendations",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(stocks.router)
app.include_router(watchlist.router)
app.include_router(notifications.router)
app.include_router(commodities.router)
app.include_router(trading.router)


@app.get("/health")
def health():
    return {"status": "ok"}
