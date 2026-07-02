import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Login } from './routes/Login';
import { Executive } from './routes/Executive';
import { Security } from './routes/Security';
import { Sla } from './routes/Sla';
import { Productivity } from './routes/Productivity';
import { Finance } from './routes/Finance';
import { Reports } from './routes/Reports';
import { Employees } from './routes/Employees';
import { EmployeeDetail } from './routes/EmployeeDetail';
import { Settings } from './routes/Settings';

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
        <Route path="/employees" element={<Employees />} />
        <Route path="/employees/:id" element={<EmployeeDetail />} />
        <Route path="/sla" element={<Sla />} />
        <Route path="/productivity" element={<Productivity />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/security" element={<Security />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
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
