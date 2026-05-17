import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useDashboardContext } from '../hooks/useDashboardContext.js';
import {
  DashboardIcon,
  UsersIcon,
  SessionsIcon,
  WorkflowIcon,
  PlaygroundIcon,
  HealthIcon,
} from './Icons.js';
import { ThemeToggle } from './ThemeToggle.js';

const links = [
  { to: '/', icon: DashboardIcon, label: 'Overview' },
  { to: '/agents', icon: UsersIcon, label: 'Agents' },
  { to: '/sessions', icon: SessionsIcon, label: 'Sessions' },
  { to: '/workflows', icon: WorkflowIcon, label: 'Workflows' },
  { to: '/playground', icon: PlaygroundIcon, label: 'Playground' },
  { to: '/health', icon: HealthIcon, label: 'Health' },
] as const;

export function Sidebar() {
  const { connected, theme, toggleTheme } = useDashboardContext();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        className="sidebar-mobile-toggle"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
      >
        <span className={`hamburger ${mobileOpen ? 'open' : ''}`} />
      </button>

      <nav className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <h1 className="sidebar-title">Xiaobai</h1>
          <span className={`sidebar-status-dot ${connected ? 'connected' : 'disconnected'}`} />
        </div>

        <ul className="sidebar-nav">
          {links.map(({ to, icon: Icon, label }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="sidebar-footer">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </nav>

      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
    </>
  );
}
