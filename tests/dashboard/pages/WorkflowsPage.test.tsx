// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkflowsPage } from '../../../src/dashboard/pages/WorkflowsPage.js';
import { DashboardContext } from '../../../src/dashboard/hooks/useDashboardContext.js';
import { createMockContext } from '../helpers/mockContext.js';

function mockFetchResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response);
}

function renderWorkflows() {
  const ctx = createMockContext();
  return render(
    <DashboardContext.Provider value={ctx}>
      <MemoryRouter>
        <WorkflowsPage />
      </MemoryRouter>
    </DashboardContext.Provider>,
  );
}

describe('WorkflowsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders page header', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ workflows: [] }),
    );
    renderWorkflows();
    expect(screen.getByText('Workflows')).toBeTruthy();
  });

  it('shows loading state', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    );
    renderWorkflows();
    expect(screen.getByText('Loading workflows...')).toBeTruthy();
  });

  it('renders workflows list', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({
        workflows: [
          { name: 'deploy', version: '1.0', description: 'Deploy app', stepCount: 3, tags: ['ci'] },
          { name: 'test', version: '2.0', stepCount: 2 },
        ],
      }),
    );
    renderWorkflows();

    await waitFor(() => {
      expect(screen.getByText('deploy')).toBeTruthy();
      expect(screen.getByText('test')).toBeTruthy();
      expect(screen.getByText('3 steps')).toBeTruthy();
      expect(screen.getByText('ci')).toBeTruthy();
    });
  });

  it('shows empty state', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ workflows: [] }),
    );
    renderWorkflows();

    await waitFor(() => {
      expect(screen.getByText('No workflows found')).toBeTruthy();
    });
  });

  it('shows select prompt', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ workflows: [] }),
    );
    renderWorkflows();

    await waitFor(() => {
      expect(screen.getByText('Select a workflow to view details and run')).toBeTruthy();
    });
  });

  it('shows error on failed fetch', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ error: 'Failed to load' }, false),
    );
    renderWorkflows();

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeTruthy();
    });
  });
});
