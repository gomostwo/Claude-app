export interface User {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
  budget?: number;
  investment_style?: string;
  time_horizon?: string;
  risk_tolerance?: string;
  telegram_chat_id?: string;
  created_at: string;
}

export interface StockQuote {
  ticker: string;
  company_name?: string;
  asset_type: string;
  price?: number;
  change?: number;
  change_percent?: number;
  volume?: number;
  market_cap?: number;
  currency?: string;
}

export interface TechnicalData {
  ticker: string;
  rsi?: number;
  macd?: number;
  macd_signal?: number;
  macd_hist?: number;
  sma_20?: number;
  sma_50?: number;
  sma_200?: number;
  ema_20?: number;
  bb_upper?: number;
  bb_middle?: number;
  bb_lower?: number;
  volume_avg_20d?: number;
  volume_ratio?: number;
  trend?: string;
}

export interface FundamentalData {
  ticker: string;
  pe_ratio?: number;
  forward_pe?: number;
  eps?: number;
  revenue_growth?: number;
  profit_margin?: number;
  debt_to_equity?: number;
  dividend_yield?: number;
  beta?: number;
  fifty_two_week_high?: number;
  fifty_two_week_low?: number;
  sector?: string;
  industry?: string;
}

export interface AIRecommendation {
  ticker: string;
  recommendation: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
  key_signals: string[];
  risks: string[];
  target_price?: number;
  analysis_timestamp?: string;
}

export interface FullAnalysis {
  quote: StockQuote;
  technical: TechnicalData;
  fundamental?: FundamentalData;
  ai_recommendation?: AIRecommendation;
}

export interface WatchlistItem {
  id: number;
  ticker: string;
  company_name?: string;
  asset_type: string;
  added_at: string;
  alert_price_above?: number;
  alert_price_below?: number;
  alert_rsi_overbought: boolean;
  alert_rsi_oversold: boolean;
}

export interface Notification {
  id: number;
  ticker?: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  telegram_sent: boolean;
  created_at: string;
}

export interface ScreenerResult {
  ticker: string;
  company_name?: string;
  asset_type: string;
  price?: number;
  rsi?: number;
  signals: string[];
}
