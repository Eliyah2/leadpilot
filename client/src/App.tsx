import { useCallback, useEffect, useState } from 'react';
import { api, setCsrf, type User, ApiError } from './lib/api';
import { currentRoute, onRouteChange, parseRoute, navigate } from './lib/util';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { FactoryPage } from './pages/Factory';
import { CreateVideoPage } from './pages/Create';
import { VideosPage, VideoDetailPage } from './pages/Videos';
import { TopicsPage } from './pages/Topics';
import { TrendsPage } from './pages/Trends';
import { CalendarPage } from './pages/Calendar';
import { YouTubePage } from './pages/YouTube';
import { AnalyticsPage } from './pages/Analytics';
import { ExperimentsPage } from './pages/Experiments';
import { SettingsPage } from './pages/Settings';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [route, setRoute] = useState(currentRoute());

  useEffect(() => onRouteChange(setRoute), []);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User; csrf: string | null }>('/auth/me');
      setUser(data.user);
      setCsrf(data.csrf ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else console.error(e);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setCsrf(null);
      navigate('/dashboard');
    }
  }, []);

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
          <p className="text-sm text-slate-500">Loading ShortForge…</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage onSignedIn={refresh} />;

  const { page, id } = parseRoute(route);

  let content: React.ReactNode;
  switch (page) {
    case 'create':
      content = <CreateVideoPage />;
      break;
    case 'factory':
      content = <FactoryPage />;
      break;
    case 'videos':
      content = id ? <VideoDetailPage id={id} /> : <VideosPage />;
      break;
    case 'topics':
      content = <TopicsPage />;
      break;
    case 'trends':
      content = <TrendsPage />;
      break;
    case 'calendar':
      content = <CalendarPage />;
      break;
    case 'youtube':
      content = <YouTubePage />;
      break;
    case 'analytics':
      content = <AnalyticsPage />;
      break;
    case 'experiments':
      content = <ExperimentsPage />;
      break;
    case 'settings':
      content = <SettingsPage user={user} />;
      break;
    case 'dashboard':
    default:
      content = <DashboardPage />;
      break;
  }

  return <Layout user={user} route={page} onLogout={logout}>{content}</Layout>;
}
