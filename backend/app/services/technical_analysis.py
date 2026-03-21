import pandas as pd
import pandas_ta as ta
from typing import Optional
from .stock_data import get_price_history
from ..utils.cache import stock_cache
from ..config import settings


def compute_technical_indicators(ticker: str) -> Optional[dict]:
    """Compute technical indicators for a ticker. Works for stocks and commodities."""
    cache_key = f"technical:{ticker}"
    cached = stock_cache.get(cache_key)
    if cached is not None:
        return cached

    df = get_price_history(ticker, period="1y", interval="1d")
    if df is None or len(df) < 30:
        return None

    try:
        close = df["Close"]
        volume = df["Volume"] if "Volume" in df.columns else None

        # RSI (14)
        rsi_series = ta.rsi(close, length=14)
        rsi = float(rsi_series.iloc[-1]) if rsi_series is not None and not rsi_series.empty else None

        # MACD (12, 26, 9)
        macd_df = ta.macd(close)
        macd = macd_signal = macd_hist = None
        if macd_df is not None and not macd_df.empty:
            macd = float(macd_df.iloc[-1, 0]) if macd_df.shape[1] > 0 else None
            macd_hist = float(macd_df.iloc[-1, 1]) if macd_df.shape[1] > 1 else None
            macd_signal = float(macd_df.iloc[-1, 2]) if macd_df.shape[1] > 2 else None

        # Simple Moving Averages
        sma_20 = _last(ta.sma(close, length=20))
        sma_50 = _last(ta.sma(close, length=50))
        sma_200 = _last(ta.sma(close, length=200))

        # EMA
        ema_20 = _last(ta.ema(close, length=20))

        # Bollinger Bands
        bb_df = ta.bbands(close, length=20)
        bb_upper = bb_lower = bb_middle = None
        if bb_df is not None and not bb_df.empty:
            bb_lower = float(bb_df.iloc[-1, 0]) if bb_df.shape[1] > 0 else None
            bb_middle = float(bb_df.iloc[-1, 1]) if bb_df.shape[1] > 1 else None
            bb_upper = float(bb_df.iloc[-1, 2]) if bb_df.shape[1] > 2 else None

        # Volume metrics
        vol_avg_20d = vol_ratio = None
        if volume is not None and len(volume) >= 20:
            vol_avg_20d = float(volume.iloc[-20:].mean())
            current_vol = float(volume.iloc[-1])
            vol_ratio = round(current_vol / vol_avg_20d, 2) if vol_avg_20d else None

        # Trend determination
        current_price = float(close.iloc[-1])
        trend = _determine_trend(current_price, sma_20, sma_50, sma_200)

        result = {
            "ticker": ticker,
            "rsi": round(rsi, 2) if rsi is not None else None,
            "macd": round(macd, 4) if macd is not None else None,
            "macd_signal": round(macd_signal, 4) if macd_signal is not None else None,
            "macd_hist": round(macd_hist, 4) if macd_hist is not None else None,
            "sma_20": round(sma_20, 4) if sma_20 is not None else None,
            "sma_50": round(sma_50, 4) if sma_50 is not None else None,
            "sma_200": round(sma_200, 4) if sma_200 is not None else None,
            "ema_20": round(ema_20, 4) if ema_20 is not None else None,
            "bb_upper": round(bb_upper, 4) if bb_upper is not None else None,
            "bb_middle": round(bb_middle, 4) if bb_middle is not None else None,
            "bb_lower": round(bb_lower, 4) if bb_lower is not None else None,
            "volume_avg_20d": round(vol_avg_20d, 0) if vol_avg_20d is not None else None,
            "volume_ratio": vol_ratio,
            "trend": trend,
        }

        stock_cache.set(cache_key, result, settings.technical_cache_ttl)
        return result

    except Exception as e:
        print(f"Technical analysis error for {ticker}: {e}")
        return None


def _last(series) -> Optional[float]:
    if series is None or series.empty:
        return None
    val = series.iloc[-1]
    return float(val) if pd.notna(val) else None


def _determine_trend(price: float, sma20, sma50, sma200) -> str:
    bullish_count = 0
    bearish_count = 0
    checks = 0
    for sma in [sma20, sma50, sma200]:
        if sma is not None:
            checks += 1
            if price > sma:
                bullish_count += 1
            else:
                bearish_count += 1
    if checks == 0:
        return "neutral"
    if bullish_count > bearish_count:
        return "bullish"
    if bearish_count > bullish_count:
        return "bearish"
    return "neutral"


def run_screener(ticker: str) -> list[str]:
    """
    Quick rule-based screener. Returns list of triggered signals.
    Empty list means no signals (skip AI analysis).
    """
    df = get_price_history(ticker, period="3mo", interval="1d")
    if df is None or len(df) < 30:
        return []

    signals = []
    close = df["Close"]
    volume = df["Volume"] if "Volume" in df.columns else None

    # RSI
    rsi_series = ta.rsi(close, length=14)
    if rsi_series is not None and not rsi_series.empty:
        rsi = float(rsi_series.iloc[-1])
        if rsi < 30:
            signals.append(f"RSI oversold ({rsi:.1f})")
        elif rsi > 70:
            signals.append(f"RSI overbought ({rsi:.1f})")

    # MACD crossover (signal cross in last 2 bars)
    macd_df = ta.macd(close)
    if macd_df is not None and len(macd_df) >= 3:
        hist = macd_df.iloc[:, 1]
        if len(hist) >= 2:
            prev = hist.iloc[-2]
            curr = hist.iloc[-1]
            if pd.notna(prev) and pd.notna(curr):
                if prev < 0 < curr:
                    signals.append("MACD bullish crossover")
                elif prev > 0 > curr:
                    signals.append("MACD bearish crossover")

    # Price vs SMA50 / SMA200 crossover
    sma50 = ta.sma(close, length=50)
    sma200 = ta.sma(close, length=200)
    if sma50 is not None and len(sma50) >= 2:
        if pd.notna(sma50.iloc[-2]) and pd.notna(sma50.iloc[-1]):
            price_now = float(close.iloc[-1])
            price_prev = float(close.iloc[-2])
            s50_now = float(sma50.iloc[-1])
            s50_prev = float(sma50.iloc[-2])
            if price_prev < s50_prev and price_now > s50_now:
                signals.append("Price crossed above SMA50")
            elif price_prev > s50_prev and price_now < s50_now:
                signals.append("Price crossed below SMA50")

    if sma200 is not None and len(sma200) >= 2 and pd.notna(sma200.iloc[-2]) and pd.notna(sma200.iloc[-1]):
        price_now = float(close.iloc[-1])
        price_prev = float(close.iloc[-2])
        s200_now = float(sma200.iloc[-1])
        s200_prev = float(sma200.iloc[-2])
        if price_prev < s200_prev and price_now > s200_now:
            signals.append("Golden Cross: Price above SMA200")
        elif price_prev > s200_prev and price_now < s200_now:
            signals.append("Death Cross: Price below SMA200")

    # Volume spike
    if volume is not None and len(volume) >= 21:
        avg = float(volume.iloc[-21:-1].mean())
        curr_vol = float(volume.iloc[-1])
        if avg > 0 and curr_vol > 2 * avg:
            signals.append(f"Volume spike ({curr_vol/avg:.1f}x avg)")

    return signals
