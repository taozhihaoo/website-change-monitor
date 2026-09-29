import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage.js';
import { AddMonitorPage } from './pages/AddMonitorPage.js';
import { MonitorDetailPage } from './pages/MonitorDetailPage.js';

export function App() {
  return (
    // Hash routing: the REST API owns the /monitors/* path space (per the
    // documented API), so the SPA navigates under /#/ to avoid conflicts.
    <HashRouter>
      <div className="app-shell">
        <header className="app-header">
          <Link to="/" className="brand">
            Website Change Monitor
          </Link>
          <span className="brand-sub">small. complete. self-hosted.</span>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/monitors/new" element={<AddMonitorPage />} />
            <Route path="/monitors/:id" element={<MonitorDetailPage />} />
            <Route path="*" element={<p className="empty-state">Page not found.</p>} />
          </Routes>
        </main>
        <footer className="app-footer">
          For monitoring public pages you are authorized to access — respect robots.txt and the
          target site's terms.
        </footer>
      </div>
    </HashRouter>
  );
}
