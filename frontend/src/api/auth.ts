import client from './client';
import { User } from '../types';

export const register = (email: string, username: string, password: string) =>
  client.post<User>('/auth/register', { email, username, password });

export const login = (username: string, password: string) => {
  const form = new FormData();
  form.append('username', username);
  form.append('password', password);
  return client.post<{ access_token: string; token_type: string }>('/auth/login', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const getMe = () => client.get<User>('/auth/me');
