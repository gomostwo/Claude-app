import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from './store/store';
import { setUser, logout } from './store/authSlice';
import { getMe } from './api/auth';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import StockDetail from './pages/StockDetail';
import Profile from './pages/Profile';
import Screener from './pages/Screener';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useSelector((s: RootState) => s.auth.token);
  return token ? <AppShell>{children}</AppShell> : <Navigate to="/login" />;
}

export default function App() {
  const dispatch = useDispatch();
  const token = useSelector((s: RootState) => s.auth.token);

  useEffect(() => {
    if (token) {
      getMe()
        .then((res) => dispatch(setUser(res.data)))
        .catch(() => dispatch(logout()));
    }
  }, []); // eslint-disable-line

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/watchlist" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/stock/:ticker" element={<PrivateRoute><StockDetail /></PrivateRoute>} />
        <Route path="/screener" element={<PrivateRoute><Screener /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
