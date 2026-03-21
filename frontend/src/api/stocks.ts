import client from './client';
import { StockQuote, TechnicalData, FundamentalData, FullAnalysis, ScreenerResult } from '../types';

export const searchStocks = (q: string) =>
  client.get<Array<{ ticker: string; name: string; asset_type: string }>>(`/stocks/search?q=${q}`);

export const getQuote = (ticker: string) =>
  client.get<StockQuote>(`/stocks/${ticker}/quote`);

export const getTechnical = (ticker: string) =>
  client.get<TechnicalData>(`/stocks/${ticker}/technical`);

export const getFundamental = (ticker: string) =>
  client.get<FundamentalData>(`/stocks/${ticker}/fundamental`);

export const analyzeStock = (ticker: string) =>
  client.post<FullAnalysis>(`/stocks/${ticker}/analyze`);

export const runScreener = () =>
  client.get<ScreenerResult[]>('/stocks/screener/scan');
