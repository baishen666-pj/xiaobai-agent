// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../src/dashboard/components/Sidebar.js';
import { DashboardContext } from '../../src/dashboard/hooks/useDashboardContext.js';
import { createMockContext } from './helpers/mockContext.js';

function renderSidebar(path = '/') {
  const ctx = createMockContext({ connected: true });
  return render(
    <DashboardContext.Provider value={ctx}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
      </MemoryRouter>
    </DashboardContext.Provider>,
  );
}

describe('Sidebar', () => {
  it('renders all 6 navigation links', () => {
    renderSidebar();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(6);
  });

  it('renders link labels', () => {
    renderSidebar();
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getByText('Workflows')).toBeTruthy();
    expect(screen.getByText('Playground')).toBeTruthy();
    expect(screen.getByText('Health')).toBeTruthy();
  });

  it('renders sidebar title', () => {
    renderSidebar();
    expect(screen.getByText('Xiaobai')).toBeTruthy();
  });

  it('marks Overview active on root path', () => {
    renderSidebar('/');
    const overviewLink = screen.getByText('Overview').closest('a');
    expect(overviewLink?.className).toContain('active');
  });

  it('marks Sessions active on /sessions path', () => {
    renderSidebar('/sessions');
    const sessionsLink = screen.getByText('Sessions').closest('a');
    expect(sessionsLink?.className).toContain('active');
  });

  it('renders mobile toggle button', () => {
    renderSidebar();
    expect(screen.getByLabelText('Open menu')).toBeTruthy();
  });

  it('shows connection status dot', () => {
    renderSidebar();
    const dot = document.querySelector('.sidebar-status-dot');
    expect(dot?.className).toContain('connected');
  });
});
