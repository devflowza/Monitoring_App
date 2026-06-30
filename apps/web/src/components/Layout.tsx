import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/executive', label: 'Executive' },
  { to: '/security', label: 'Security & DLP' },
];

export function Layout() {
  const { roles, signOut, configured } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-edge bg-panel/60 p-4">
        <div className="mb-6">
          <div className="text-lg font-bold text-slate-100">Sentinel</div>
          <div className="text-xs text-slate-500">Vision Freights LLC</div>
        </div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-edge text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-8 text-[11px] text-slate-500">
          <div className="mb-1 uppercase tracking-wide">Roles</div>
          <div>{roles.length ? roles.join(', ') : 'viewer'}</div>
        </div>
        <button
          onClick={() => signOut()}
          className="mt-6 w-full rounded-lg border border-edge px-3 py-2 text-xs text-slate-300 hover:bg-edge"
        >
          Sign out
        </button>
      </aside>

      <main className="flex-1 p-6">
        {!configured && (
          <div className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-200">
            Supabase is not configured (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY). Showing empty states.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
