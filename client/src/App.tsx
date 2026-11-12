import { useEffect, useState, type ReactElement } from 'react';
import { HashRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage.js';
import { AddMonitorPage } from './pages/AddMonitorPage.js';
import { MonitorDetailPage } from './pages/MonitorDetailPage.js';
import { I18nProvider, useI18n } from './i18n.js';
import { BrandMark, Icon } from './components/ui.js';

type Theme = 'light' | 'dark';
const THEME_KEY = 'wcm.theme';

function detectTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // storage unavailable — follow the OS preference
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function Shell(): ReactElement {
  const { t, locale, setLocale } = useI18n();
  const [theme, setTheme] = useState<Theme>(detectTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore storage failures (private mode)
    }
  }, [theme]);

  return (
    <div className="app-shell">
      <div className="ambient" aria-hidden="true" />

      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="brand">
            <BrandMark />
            <span className="brand-text">
              <span className="brand-name">{t('app.name')}</span>
              <span className="brand-sub">{t('app.tagline')}</span>
            </span>
          </Link>

          <nav className="header-nav" aria-label="Main">
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}
            >
              <Icon name="grid" size={15} />
              {t('nav.dashboard')}
            </NavLink>
            <NavLink
              to="/monitors/new"
              className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}
            >
              <Icon name="plus" size={15} />
              {t('nav.add')}
            </NavLink>
          </nav>

          <div className="header-tools">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
              title={t('language.toggle')}
              aria-label={t('language.toggle')}
            >
              <Icon name="globe" size={16} />
              <span className="tool-label">{locale === 'en' ? '中文' : 'EN'}</span>
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-square"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={t('theme.toggle')}
              aria-label={t('theme.toggle')}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/monitors/new" element={<AddMonitorPage />} />
          <Route path="/monitors/:id" element={<MonitorDetailPage />} />
          <Route path="*" element={<p className="empty-state">{t('error.pageNotFound')}</p>} />
        </Routes>
      </main>

      <footer className="app-footer">
        <div className="footer-inner">
          <span className="footer-brand">
            <BrandMark size={20} />
            {t('app.name')}
          </span>
          <span className="footer-note">{t('app.footer')}</span>
        </div>
      </footer>
    </div>
  );
}

export function App(): ReactElement {
  return (
    <I18nProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </I18nProvider>
  );
}
