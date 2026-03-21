import client from './client';
import { WatchlistItem } from '../types';

export const getWatchlist = () => client.get<WatchlistItem[]>('/watchlist');

export const addToWatchlist = (data: {
  ticker: string;
  alert_price_above?: number;
  alert_price_below?: number;
  alert_rsi_overbought?: boolean;
  alert_rsi_oversold?: boolean;
}) => client.post<WatchlistItem>('/watchlist', data);

export const updateWatchlistItem = (id: number, data: Partial<WatchlistItem>) =>
  client.put<WatchlistItem>(`/watchlist/${id}`, data);

export const removeFromWatchlist = (id: number) =>
  client.delete(`/watchlist/${id}`);
