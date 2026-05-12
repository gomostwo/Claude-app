import yfinance as yf
import pandas as pd
from typing import Optional
from ..utils.cache import stock_cache, universe_cache
from ..config import settings

COMMODITY_TICKERS = {
    "GLD": "SPDR Gold Shares",
    "SLV": "iShares Silver Trust",
    "USO": "United States Oil Fund (WTI)",
    "BNO": "United States Brent Oil Fund",
    "UNG": "United States Natural Gas Fund",
    "DBC": "Invesco DB Commodity Index Tracking Fund",
}

# Correlation groups — risk manager prevents stacking exposure within a group.
COMMODITY_GROUPS = {
    "gold": ["GLD"],
    "silver": ["SLV"],
    "oil": ["USO", "BNO"],
    "gas": ["UNG"],
    "broad": ["DBC"],
}


def commodity_group_for(ticker: str) -> str | None:
    """Return the COMMODITY_GROUPS bucket key for an ETF, or None if not a tracked commodity."""
    for bucket, members in COMMODITY_GROUPS.items():
        if ticker in members:
            return bucket
    return None


def get_stock_info(ticker: str) -> dict:
    """Get stock/commodity info dict from yfinance with caching."""
    cache_key = f"info:{ticker}"
    cached = stock_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
    except Exception:
        info = {}

    stock_cache.set(cache_key, info, settings.fundamental_cache_ttl)
    return info


def get_price_history(ticker: str, period: str = "6mo", interval: str = "1d") -> Optional[pd.DataFrame]:
    """Get OHLCV history for a ticker."""
    cache_key = f"hist:{ticker}:{period}:{interval}"
    cached = stock_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        t = yf.Ticker(ticker)
        df = t.history(period=period, interval=interval)
        if df is None or df.empty:
            return None
    except Exception:
        return None

    ttl = settings.technical_cache_ttl
    stock_cache.set(cache_key, df, ttl)
    return df


def get_current_quote(ticker: str) -> dict:
    """Get current price quote for a ticker."""
    cache_key = f"quote:{ticker}"
    cached = stock_cache.get(cache_key)
    if cached is not None:
        return cached

    info = get_stock_info(ticker)
    is_commodity = ticker in COMMODITY_TICKERS

    price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("ask")
    prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")
    change = None
    change_pct = None
    if price and prev_close and prev_close != 0:
        change = round(price - prev_close, 4)
        change_pct = round((change / prev_close) * 100, 2)

    result = {
        "ticker": ticker,
        "company_name": COMMODITY_TICKERS.get(ticker) or info.get("shortName") or info.get("longName") or ticker,
        "asset_type": "commodity" if is_commodity else "stock",
        "price": price,
        "change": change,
        "change_percent": change_pct,
        "volume": info.get("volume") or info.get("regularMarketVolume"),
        "market_cap": info.get("marketCap"),
        "currency": info.get("currency", "USD"),
    }

    stock_cache.set(cache_key, result, 60)  # 1-min cache for live quotes
    return result


def get_universe() -> list[dict]:
    """Return the full list of tickers to monitor: S&P500 + NASDAQ100 + Dow30 + commodities."""
    cached = universe_cache.get("universe")
    if cached is not None:
        return cached

    tickers = {}

    # Commodities always included
    for sym, name in COMMODITY_TICKERS.items():
        tickers[sym] = {"ticker": sym, "name": name, "asset_type": "commodity"}

    # S&P 500
    try:
        sp500 = pd.read_html("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")[0]
        for _, row in sp500.iterrows():
            sym = str(row.get("Symbol", "")).replace(".", "-")
            name = str(row.get("Security", ""))
            if sym:
                tickers[sym] = {"ticker": sym, "name": name, "asset_type": "stock"}
    except Exception:
        pass

    # NASDAQ 100
    try:
        nq = pd.read_html("https://en.wikipedia.org/wiki/Nasdaq-100")[4]
        for _, row in nq.iterrows():
            sym = str(row.get("Ticker", "") or row.get("Symbol", "")).replace(".", "-")
            name = str(row.get("Company", "") or row.get("Security", ""))
            if sym and sym != "nan":
                tickers[sym] = {"ticker": sym, "name": name, "asset_type": "stock"}
    except Exception:
        pass

    # Dow 30
    try:
        dow = pd.read_html("https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average")[1]
        for _, row in dow.iterrows():
            sym = str(row.get("Symbol", "") or row.get("Ticker", "")).replace(".", "-")
            name = str(row.get("Company", "") or row.get("Name", ""))
            if sym and sym != "nan":
                tickers[sym] = {"ticker": sym, "name": name, "asset_type": "stock"}
    except Exception:
        pass

    result = list(tickers.values())
    universe_cache.set("universe", result, settings.universe_cache_ttl)
    return result


def search_tickers(query: str) -> list[dict]:
    """Search universe for matching tickers or company names."""
    universe = get_universe()
    q = query.lower()
    results = []
    for item in universe:
        if q in item["ticker"].lower() or q in item["name"].lower():
            results.append(item)
    # Also check commodities explicitly
    for sym, name in COMMODITY_TICKERS.items():
        if q in sym.lower() or q in name.lower():
            existing = any(r["ticker"] == sym for r in results)
            if not existing:
                results.append({"ticker": sym, "name": name, "asset_type": "commodity"})
    return results[:20]
