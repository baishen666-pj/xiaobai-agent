// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OverviewPage } from '../../../src/dashboard/pages/OverviewPage.js';
import { DashboardContext } from '../../../src/dashboard/hooks/useDashboardContext.js';
import { createMockContext } from '../helpers/mockContext.js';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

function renderOverview() {
  const ctx = createMockContext({
    connected: true,
    agents: [{ id: 'a1', role: 'coder', busy: false }],
    tasks: [{ id: 't1', description: 'Test task', role: 'coder', status: 'pending' }],
    tokenTotal: 100,
    events: [{ type: 'info', timestamp: 0, message: 'test' }],
  });
  return render(
    <DashboardContext.Provider value={ctx}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </DashboardContext.Provider>,
  );
}

describe('OverviewPage', () => {
  it('renders dashboard header', () => {
    renderOverview();
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('renders connection controls', () => {
    renderOverview();
    expect(screen.getByPlaceholderText('WebSocket URL')).toBeTruthy();
    expect(screen.getByText('Disconnect')).toBeTruthy();
  });

  it('renders section headings', () => {
    renderOverview();
    // These headings may appear in summary cards and section headers
    const agentHeadings = screen.getAllByText('Agents');
    expect(agentHeadings.length).toBeGreaterThanOrEqual(1);
    const chatHeadings = screen.getAllByText('Chat');
    expect(chatHeadings.length).toBeGreaterThanOrEqual(1);
    const tokenHeadings = screen.getAllByText('Tokens');
    expect(tokenHeadings.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Event Log')).toBeTruthy();
  });
});
