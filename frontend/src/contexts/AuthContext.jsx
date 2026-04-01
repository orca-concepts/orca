import React, { createContext, useState, useContext, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if user is logged in on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const response = await authAPI.getCurrentUser();
          setUser(response.data.user);
        } catch (error) {
          console.error('Auth check failed:', error);
          localStorage.removeItem('token');
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  // Password login (Phase 40b)
  const login = async (identifier, password) => {
    try {
      setError(null);
      const response = await authAPI.login(identifier, password);
      const { token, user } = response.data;
      localStorage.setItem('token', token);
      setUser(user);
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.error || 'Login failed';
      setError(message);
      return { success: false, error: message };
    }
  };

  // Phone OTP for registration (Phase 40b)
  const sendCode = async (phoneNumber, intent) => {
    try {
      const response = await authAPI.sendCode(phoneNumber, intent);
      return response.data;
    } catch (error) {
      throw error;
    }
  };

  const phoneRegister = async (phoneNumber, code, username, email, password, ageVerified) => {
    try {
      setError(null);
      const response = await authAPI.verifyRegister(phoneNumber, code, username, email, password, ageVerified);
      const { token, user } = response.data;
      localStorage.setItem('token', token);
      setUser(user);
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.error || 'Registration failed';
      setError(message);
      return { success: false, error: message };
    }
  };

  // Forgot password (Phase 40b)
  const forgotPasswordSendCode = async (phoneNumber) => {
    try {
      const response = await authAPI.forgotPasswordSendCode(phoneNumber);
      return response.data;
    } catch (error) {
      throw error;
    }
  };

  const forgotPasswordReset = async (phoneNumber, code, newPassword) => {
    try {
      setError(null);
      const response = await authAPI.forgotPasswordReset(phoneNumber, code, newPassword);
      const { token, user } = response.data;
      localStorage.setItem('token', token);
      setUser(user);
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.error || 'Password reset failed';
      setError(message);
      return { success: false, error: message };
    }
  };

  const logoutEverywhere = async () => {
    try {
      await authAPI.logoutEverywhere();
    } catch (error) {
      console.error('Logout everywhere API failed:', error);
    }
    localStorage.removeItem('token');
    setUser(null);
  };

  const value = {
    user,
    loading,
    error,
    logout,
    login,
    sendCode,
    phoneRegister,
    forgotPasswordSendCode,
    forgotPasswordReset,
    logoutEverywhere,
    isAuthenticated: !!user,
    isGuest: !user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
