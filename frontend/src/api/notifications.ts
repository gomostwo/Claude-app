import client from './client';
import { Notification } from '../types';

export const getNotifications = (unreadOnly = false) =>
  client.get<Notification[]>(`/notifications${unreadOnly ? '?unread_only=true' : ''}`);

export const markRead = (id: number) =>
  client.put<Notification>(`/notifications/${id}/read`);

export const markAllRead = () => client.put('/notifications/mark-all-read');

export const clearRead = () => client.delete('/notifications/read-all');
