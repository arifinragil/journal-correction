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
  const link = (to, label, icon) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive ? 'bg-prestisa text-white shadow-sm' : 'text-prestisa-700 hover:bg-prestisa-50'
        }`}
    >
      <span className="w-5 text-center">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
  return (
    <div className="min-h-full flex">
      <aside className="w-64 bg-white border-r border-prestisa-100 flex flex-col">
        <div className="px-5 py-6 border-b border-prestisa-100">
          <img src="/logo.png" className="h-9 w-auto mb-2" alt="Prestisa" />
          <div className="text-[11px] uppercase tracking-widest text-prestisa-500 font-bold">Correction Journals</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {link('/', 'Dashboard', '◧')}
          {link('/corrections', 'Corrections', '≡')}
          {(user.role === 'maker' || user.role === 'admin') && link('/corrections/new', 'New Correction', '+')}
          {user.role === 'admin' && link('/users', 'Users', '◔')}
        </nav>
        <div className="p-3 border-t border-prestisa-100">
          <div className="px-3 py-2 mb-2">
            <div className="text-sm font-semibold text-prestisa-800">{user.full_name}</div>
            <div className="text-xs text-prestisa-500 capitalize">{user.role} · @{user.username}</div>
          </div>
          <button onClick={onLogout} className="btn-ghost w-full">Logout</button>
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
