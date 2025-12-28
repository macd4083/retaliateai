import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import AuthCallback from './pages/AuthCallback';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ??  Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] :  <></>;
const LoginPage = Pages['Login'];

const LayoutWrapper = ({ children, currentPageName }) => Layout ? 
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();

  // Show loading spinner while checking auth
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Loading... </p>
        </div>
      </div>
    );
  }

  // If not authenticated, show login page
  if (! isAuthenticated) {
    return (
      <Routes>
        <Route path="/Login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/Login" replace />} />
      </Routes>
    );
  }

  // Render the main app for authenticated users
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <Routes>
          {/* Public auth callback route - must be outside AuthenticatedApp */}
          <Route path="/auth/callback" element={<AuthCallback />} />
          
          {/* All other routes */}
          <Route path="*" element={<AuthenticatedApp />} />
        </Routes>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App