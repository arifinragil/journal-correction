import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, Link, useLocation, NavLink } from 'react-router-dom';
import api from './api';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CorrectionListPage from './pages/CorrectionListPage.jsx';
import CorrectionFormPage from './pages/CorrectionFormPage.jsx';
import CorrectionDetailPage from './pages/CorrectionDetailPage.jsx';
import UserAdminPage from './pages/UserAdminPage.jsx';

export const AuthCtx = React.createContext(null);

function Shell({ user, onLogout, children }) {
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('jc.sidebar.collapsed') === '1'; } catch { return false; }
  });
  const toggle = () => {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('jc.sidebar.collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  };
  const link = (to, label, icon) => (
    <NavLink
      to={to}
      end={to === '/'}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 ${collapsed ? 'justify-center px-0' : 'px-4'} py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive ? 'bg-prestisa text-white shadow-sm' : 'text-prestisa-700 hover:bg-prestisa-50'
        }`}
    >
      <span className="w-5 text-center flex-shrink-0">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
  return (
    <div className="min-h-full flex">
      <aside className={`${collapsed ? 'w-16' : 'w-64'} bg-white border-r border-prestisa-100 flex flex-col transition-all duration-200`}>
        <div className={`${collapsed ? 'px-2 py-4' : 'px-5 py-6'} border-b border-prestisa-100 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <img src="/logo.png" className="h-9 w-auto mb-2" alt="Prestisa" />
              <div className="text-[11px] uppercase tracking-widest text-prestisa-500 font-bold">Correction Journals</div>
            </div>
          )}
          <button
            onClick={toggle}
            title={collapsed ? 'Buka sidebar' : 'Sembunyikan sidebar'}
            className="p-1.5 rounded-lg text-prestisa-400 hover:bg-prestisa-50 hover:text-prestisa-700 transition-colors flex-shrink-0"
          >
            {collapsed ? '▶' : '◀'}
          </button>
        </div>
        <nav className={`flex-1 ${collapsed ? 'p-2' : 'p-3'} space-y-1`}>
          {link('/', 'Dashboard', '◧')}
          {link('/corrections', 'Corrections', '≡')}
          {(user.role === 'maker' || user.role === 'admin') && link('/corrections/new', 'New Correction', '+')}
          {user.role === 'admin' && link('/users', 'Users', '◔')}
        </nav>
        <div className={`${collapsed ? 'p-2' : 'p-3'} border-t border-prestisa-100`}>
          {!collapsed && (
            <div className="px-3 py-2 mb-2">
              <div className="text-sm font-semibold text-prestisa-800 truncate">{user.full_name}</div>
              <div className="text-xs text-prestisa-500 capitalize truncate">{user.role} · @{user.username}</div>
            </div>
          )}
          <button
            onClick={onLogout}
            title={collapsed ? 'Logout' : undefined}
            className={`btn-ghost w-full ${collapsed ? 'px-0 justify-center' : ''}`}
          >
            {collapsed ? '⎋' : 'Logout'}
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <header className="bg-white border-b border-prestisa-100 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h1 className="text-lg font-bold text-prestisa-800">{({
              '/': 'Dashboard',
              '/corrections': 'Corrections',
              '/corrections/new': 'New Correction',
              '/users': 'User Management',
            })[loc.pathname] || (loc.pathname.startsWith('/corrections/') ? 'Correction Detail' : '')}</h1>
            <div className="text-xs text-prestisa-500">journal.prestisa.net · Connected With Excellence</div>
          </div>
        </header>
        <div className="p-8">
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </AuthCtx.Provider>
  );
}
