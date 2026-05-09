import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Toast } from './shared/Toast';

export function Layout() {
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  const currentPage = (() => {
    const path = location.pathname;
    if (path === '/') return 'dashboard';
    if (path.startsWith('/contracts')) return 'contracts';
    if (path.startsWith('/requests')) return 'requests';
    if (path.startsWith('/agents')) return 'agents';
    if (path.startsWith('/eval')) return 'eval';
    if (path.startsWith('/traces')) return 'traces';
    if (path.startsWith('/deployments')) return 'deployments';
    return '';
  })();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navLink = (path: string, label: string, icon: React.ReactNode) => (
    <Link
      to={path}
      className={`nav-link ${currentPage === path.slice(1) || (path === '/' && currentPage === 'dashboard') ? 'active' : ''}`}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 h-14" style={{
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
      }}>
        {/* Animated gradient stripe */}
        <div className="absolute top-0 left-0 right-0 h-[2.5px] gradient-stripe" />

        <div className="h-full px-5 flex items-center gap-4" style={{ maxWidth: '1280px', margin: '0 auto' }}>
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0 no-underline">
            <div className="leading-none">
              <div className="text-sm font-extrabold tracking-tight font-mono"
                style={{
                  background: 'linear-gradient(135deg,#FF6200,#cc4e00)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>
                JaguarData
              </div>
              <div className="text-[10px] text-gray-400 font-mono">Data Contracts</div>
            </div>
          </Link>

          {/* Divider */}
          <div className="h-5 w-px bg-gray-200 shrink-0" />

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {navLink('/', 'Dashboard',
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            )}
            {navLink('/contracts', 'Catalogo',
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            {navLink('/requests', 'Solicitacoes',
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            )}
            {navLink('/agents', 'Agentes',
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )}
            {navLink('/eval', 'Avaliacao',
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            )}
            {navLink('/traces', 'Traces',
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
            {navLink('/deployments', 'Deploy',
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </nav>

          <div className="flex-1" />

          {/* Role switcher + user */}
          {user && (
            <div className="flex items-center gap-3">
              {/* Role badge */}
              <div className="text-xs font-mono text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 uppercase">
                {user.role}
              </div>

              {/* User avatar */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: 'linear-gradient(135deg,#FF6200,#E05200)' }}>
                  {user.name[0]}
                </div>
                <div className="hidden md:block">
                  <div className="text-xs font-semibold text-gray-800 leading-none mb-0.5">{user.name}</div>
                  <div className="text-[10px] text-gray-400 font-mono uppercase leading-none">{user.role}</div>
                </div>
                <button
                  onClick={handleLogout}
                  title="Sair"
                  className="ml-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Page content */}
      {(currentPage === 'agents') ? (
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      ) : (
        <main className="flex-1 overflow-auto">
          <div className="px-5 py-8" style={{ maxWidth: '1280px', margin: '0 auto' }}>
            <Outlet />
          </div>
        </main>
      )}

      <Toast />
    </div>
  );
}
