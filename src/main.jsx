import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from './App.jsx';
import { AuthProvider } from './lib/AuthContext';
import { queryClient } from './lib/query-client';
import { initAnalytics } from './lib/analytics';
import { installUnhandledRejectionLogger } from './lib/runtimeDiagnostics';
import PWAUpdatePrompt from './components/pwa/PWAUpdatePrompt';
import StorageNotice from './components/StorageNotice';
import SchemaDiagnostics from './v2/components/SchemaDiagnostics';
import './index.css';

installUnhandledRejectionLogger();
initAnalytics();

// FIX: Removed React.StrictMode — it was causing useEffect to fire twice
// in production, which sent __INIT__ to the API twice = duplicate opening messages
ReactDOM.createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <PWAUpdatePrompt />
        <div className="fixed top-14 left-0 right-0 z-[90] max-h-[50vh] overflow-y-auto">
          <StorageNotice />
          <SchemaDiagnostics />
        </div>
      </AuthProvider>
    </BrowserRouter>
    <ReactQueryDevtools initialIsOpen={false} />
  </QueryClientProvider>
);