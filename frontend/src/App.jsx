import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, Link, useLocation, NavLink } from 'react-router-dom';
import api from './api';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CorrectionListPage from './pages/CorrectionListPage.jsx';
import CorrectionFormPage from './pages/CorrectionFormPage.jsx';
import CorrectionDetailPage from './pages/CorrectionDetailPage.jsx';
import UserAdminPage from './pages/UserAdminPage.jsx';
import AgentProposalsPage from './pages/AgentProposalsPage.jsx';

export const AuthCtx = React.createContext(null);

function Shell({ user, onLogout, children }) {
  const loc = useLocation();
  // Desktop: collapse to icon-only rail. Persisted.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('jc.sidebar.collapsed') === '1'; } catch { return false; }
  });
  // Mobile: drawer open/closed (transient).
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('jc.sidebar.collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  };
  // Close mobile drawer on route change.
  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);

  const link = (to, label, icon) => (
    <NavLink
      to={to}
      end={to === '/'}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 ${collapsed ? 'md:justify-center md:px-0' : ''} px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive ? 'bg-prestisa text-white shadow-sm' : 'text-prestisa-700 hover:bg-prestisa-50'
        }`}
    >
      <span className="w-5 text-center flex-shrink-0">{icon}</span>
      <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
    </NavLink>
  );

  return (
    <div className="min-h-full md:flex">
      {/* Backdrop (mobile only) */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 bg-white border-r border-prestisa-100 flex flex-col
          transition-transform duration-200
          w-64 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:transition-all
          ${collapsed ? 'md:w-16' : 'md:w-64'}
        `}
      >
        <div className={`px-5 py-6 ${collapsed ? 'md:px-2 md:py-4' : ''} border-b border-prestisa-100 flex items-center justify-between gap-2`}>
          <div className={`flex-1 min-w-0 ${collapsed ? 'md:hidden' : ''}`}>
            <img src="/logo.png" className="h-9 w-auto mb-2" alt="Prestisa" />
            <div className="text-[11px] uppercase tracking-widest text-prestisa-500 font-bold">Correction Journals</div>
          </div>
          {/* Mobile close */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-prestisa-400 hover:bg-prestisa-50 hover:text-prestisa-700"
            aria-label="Tutup menu"
          >✕</button>
          {/* Desktop collapse */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Buka sidebar' : 'Sembunyikan sidebar'}
            className="hidden md:inline-flex p-1.5 rounded-lg text-prestisa-400 hover:bg-prestisa-50 hover:text-prestisa-700 transition-colors flex-shrink-0"
          >
            {collapsed ? '▶' : '◀'}
          </button>
        </div>
        <nav className={`flex-1 p-3 ${collapsed ? 'md:p-2' : ''} space-y-1 overflow-y-auto`}>
          {link('/', 'Dashboard', '◧')}
          {link('/corrections', 'Corrections', '≡')}
          {(user.role === 'maker' || user.role === 'admin') && link('/corrections/new', 'New Correction', '+')}
          {link('/agent-proposals', 'Agent Proposals', '🤖')}
          {user.role === 'admin' && link('/users', 'Users', '◔')}
        </nav>
        <div className={`p-3 ${collapsed ? 'md:p-2' : ''} border-t border-prestisa-100`}>
          <div className={`px-3 py-2 mb-2 ${collapsed ? 'md:hidden' : ''}`}>
            <div className="text-sm font-semibold text-prestisa-800 truncate">{user.full_name}</div>
            <div className="text-xs text-prestisa-500 capitalize truncate">{user.role} · @{user.username}</div>
          </div>
          <button
            onClick={onLogout}
            title={collapsed ? 'Logout' : undefined}
            className={`btn-ghost w-full ${collapsed ? 'md:px-0 md:justify-center' : ''}`}
          >
            <span className={collapsed ? 'md:hidden' : ''}>Logout</span>
            <span className={`hidden ${collapsed ? 'md:inline' : ''}`}>⎋</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto min-w-0">
        <header className="bg-white border-b border-prestisa-100 px-4 md:px-8 py-3 md:py-4 flex items-center gap-3 sticky top-0 z-20">
          {/* Hamburger (mobile) */}
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 -ml-2 rounded-lg text-prestisa-700 hover:bg-prestisa-50"
            aria-label="Buka menu"
          >☰</button>
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold text-prestisa-800 truncate">{({
              '/': 'Dashboard',
              '/corrections': 'Corrections',
              '/corrections/new': 'New Correction',
              '/users': 'User Management',
              '/agent-proposals': 'Agent Proposals',
            })[loc.pathname] || (loc.pathname.startsWith('/corrections/') ? 'Correction Detail' : '')}</h1>
            <div className="hidden sm:block text-xs text-prestisa-500 truncate">journal.prestisa.net · Connected With Excellence</div>
          </div>
        </header>
        <div className="p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    api.get('/me').then(r => setUser(r.data)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const onLoggedIn = (u) => { setUser(u); navigate('/'); };
  const onLogout = async () => { await api.post('/logout'); setUser(null); navigate('/login'); };

  if (loading) return <div className="h-full flex items-center justify-center text-prestisa-400">Memuat…</div>;
  if (!user) {
    return loc.pathname === '/login'
      ? <LoginPage onLoggedIn={onLoggedIn} />
      : <Navigate to="/login" replace />;
  }
  if (loc.pathname === '/login') return <Navigate to="/" replace />;

  return (
    <AuthCtx.Provider value={user}>
      <Shell user={user} onLogout={onLogout}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/corrections" element={<CorrectionListPage />} />
          <Route path="/corrections/new" element={<CorrectionFormPage />} />
          <Route path="/corrections/:id" element={<CorrectionDetailPage />} />
          <Route path="/users" element={<UserAdminPage />} />
          <Route path="/agent-proposals" element={<AgentProposalsPage />} />
          <Route path="/agent-proposals/:id" element={<AgentProposalsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </AuthCtx.Provider>
  );
}
