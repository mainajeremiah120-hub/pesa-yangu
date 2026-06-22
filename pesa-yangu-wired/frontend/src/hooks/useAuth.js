/**
 * frontend/src/hooks/useAuth.js
 * Manages authentication state across the app.
 * Exposes: user, plan, loading, login, register, logout
 */
import { useState, useEffect, useCallback } from "react";
import { authApi } from "../lib/api";

export function useAuth() {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true); // true while checking stored token

  // On mount: if a token exists, validate it by fetching /auth/me
  useEffect(() => {
    const token = localStorage.getItem("py_access_token");
    if (!token) { setLoading(false); return; }
    authApi.me()
      .then((data) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem("py_access_token");
        localStorage.removeItem("py_refresh_token");
      })
      .finally(() => setLoading(false));
  }, []);

  // Listen for the 401-logout signal from the axios interceptor
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener("py:logout", handler);
    return () => window.removeEventListener("py:logout", handler);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authApi.login({ email, password });
    localStorage.setItem("py_access_token",  data.accessToken);
    localStorage.setItem("py_refresh_token", data.refreshToken);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (email, password, full_name) => {
    const data = await authApi.register({ email, password, full_name });
    localStorage.setItem("py_access_token",  data.accessToken);
    localStorage.setItem("py_refresh_token", data.refreshToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((u) => u ? { ...u, ...patch } : u);
  }, []);

  return {
    user,
    plan:    user?.plan || "free",
    loading,
    login,
    register,
    logout,
    updateUser,
    isAuthenticated: !!user,
  };
}
