// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentsPage } from '../../../src/dashboard/pages/AgentsPage.js';
import { DashboardContext } from '../../../src/dashboard/hooks/useDashboardContext.js';
import { createMockContext } from '../helpers/mockContext.js';

function renderAgents(overrides?: Record<string, unknown>) {
  const ctx = createMockContext({
    agents: [
      { id: 'agent-1', role: 'coder', busy: false },
      { id: 'agent-2', role: 'reviewer', busy: true, currentTask: 't1' },
    ],
    tasks: [],
    ...overrides,
  });
  return render(
    <DashboardContext.Provider value={ctx}>
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    </DashboardContext.Provider>,
  );
}

describe('AgentsPage', () => {
  it('renders page header with agent count', () => {
    renderAgents();
    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('2 agents registered')).toBeTruthy();
  });

  it('renders agent cards', () => {
    renderAgents();
    // Agent IDs appear in multiple places (status panel + cards)
    const allAgent1 = screen.getAllByText('agent-1');
    expect(allAgent1.length).toBeGreaterThanOrEqual(1);
    const allAgent2 = screen.getAllByText('agent-2');
    expect(allAgent2.length).toBeGreaterThanOrEqual(1);
  });

  it('shows agent roles', () => {
    renderAgents();
    const allCoder = screen.getAllByText('coder');
    expect(allCoder.length).toBeGreaterThanOrEqual(1);
    const allReviewer = screen.getAllByText('reviewer');
    expect(allReviewer.length).toBeGreaterThanOrEqual(1);
  });

  it('shows current task for busy agent', () => {
    renderAgents();
    expect(screen.getByText('Task: t1')).toBeTruthy();
  });

  it('shows empty state when no agents', () => {
    renderAgents({ agents: [] });
    expect(screen.getByText('No agents connected. Start the orchestrator to see agents here.')).toBeTruthy();
  });
});
