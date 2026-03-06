import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from './App.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import EmailConfirmed from './pages/EmailConfirmed.jsx';
import GoalDetail from './pages/GoalDetail.jsx'; // NEW
import AuthGuard from './components/auth/AuthGaurd.jsx';
import { AuthProvider } from './lib/AuthContext';
import { queryClient } from './lib/query-client';
import './index.css';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
import TermsOfService from './pages/TermsOfService.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/auth/reset-password" element={<ResetPassword />} />
            <Route path="/auth/callback" element={<EmailConfirmed />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />

            {/* Protected routes */}
            <Route
              path="/journal"
              element={
                <AuthGuard>
                  <App />
                </AuthGuard>
              }
            />
            <Route
              path="/goals/:goalId"
              element={
                <AuthGuard>
                  <GoalDetail />
                </AuthGuard>
              }
            />
            <Route path="/Journal" element={<Navigate to="/journal" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
);