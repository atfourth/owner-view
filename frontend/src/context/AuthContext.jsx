import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('ironpulse_token');
    if (!token) {
      setLoading(false);
      return;
    }

    api
      .getMe()
      .then((res) => setUser(res.user))
      .catch(() => {
        localStorage.removeItem('ironpulse_token');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const res = await api.login({ email, password });
    localStorage.setItem('ironpulse_token', res.token);
    setUser(res.user);
    return res.user;
  }

  async function register(payload) {
    const res = await api.register(payload);
    localStorage.setItem('ironpulse_token', res.token);
    setUser(res.user);
    return res.user;
  }

  async function refreshUser() {
    const res = await api.getMe();
    setUser(res.user);
    return res.user;
  }

  function logout() {
    localStorage.removeItem('ironpulse_token');
    setUser(null);
  }

  const isStaffOrAdmin = user?.role === 'admin' || user?.role === 'staff';
  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        refreshUser,
        isStaffOrAdmin,
        isAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
