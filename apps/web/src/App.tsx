import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Login } from './routes/Login';
import { Executive } from './routes/Executive';
import { Security } from './routes/Security';

function Shell() {
  const { loading, session, configured } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>;
  }
  // When Supabase is wired, require a session. In unconfigured/dev mode, allow
  // the dashboard through so the UI is reviewable without a backend.
  if (configured && !session) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/executive" element={<Executive />} />
        <Route path="/security" element={<Security />} />
        <Route path="*" element={<Navigate to="/executive" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </AuthProvider>
  );
}
