from pydantic import BaseModel
from typing import Optional, List


class StockQuote(BaseModel):
    ticker: str
    company_name: Optional[str]
    asset_type: str  # stock / commodity
    price: Optional[float]
    change: Optional[float]
    change_percent: Optional[float]
    volume: Optional[int]
    market_cap: Optional[float]
    currency: Optional[str]


class TechnicalData(BaseModel):
    ticker: str
    rsi: Optional[float]
    macd: Optional[float]
    macd_signal: Optional[float]
    macd_hist: Optional[float]
    sma_20: Optional[float]
    sma_50: Optional[float]
    sma_200: Optional[float]
    ema_20: Optional[float]
    bb_upper: Optional[float]
    bb_middle: Optional[float]
    bb_lower: Optional[float]
    volume_avg_20d: Optional[float]
    volume_ratio: Optional[float]  # current vs avg
    trend: Optional[str]  # bullish/bearish/neutral


class FundamentalData(BaseModel):
    ticker: str
    pe_ratio: Optional[float]
    forward_pe: Optional[float]
    eps: Optional[float]
    revenue_growth: Optional[float]
    profit_margin: Optional[float]
    debt_to_equity: Optional[float]
    dividend_yield: Optional[float]
    beta: Optional[float]
    fifty_two_week_high: Optional[float]
    fifty_two_week_low: Optional[float]
    sector: Optional[str]
    industry: Optional[str]


class AIRecommendation(BaseModel):
    ticker: str
    recommendation: str  # BUY / SELL / HOLD
    confidence: int      # 0-100
    reasoning: str
    key_signals: List[str]
    risks: List[str]
    target_price: Optional[float]
    analysis_timestamp: Optional[str]


class FullAnalysis(BaseModel):
    quote: StockQuote
    technical: TechnicalData
    fundamental: Optional[FundamentalData]
    ai_recommendation: Optional[AIRecommendation]


class ScreenerResult(BaseModel):
    ticker: str
    company_name: Optional[str]
    asset_type: str
    price: Optional[float]
    rsi: Optional[float]
    signals: List[str]
