// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionsPage } from '../../../src/dashboard/pages/SessionsPage.js';
import { DashboardContext } from '../../../src/dashboard/hooks/useDashboardContext.js';
import { createMockContext } from '../helpers/mockContext.js';

function mockFetchResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response);
}

function renderSessions(ctxOverrides?: Record<string, unknown>) {
  const ctx = createMockContext(ctxOverrides);
  return render(
    <DashboardContext.Provider value={ctx}>
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>
    </DashboardContext.Provider>,
  );
}

describe('SessionsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders page header with New Session button', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ sessions: [] }),
    );
    renderSessions();
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getByText('New Session')).toBeTruthy();
  });

  it('shows loading state initially', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}), // Never resolves
    );
    renderSessions();
    expect(screen.getByText('Loading sessions...')).toBeTruthy();
  });

  it('renders sessions list', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({
        sessions: [
          { id: 's1', createdAt: 1000, updatedAt: 2000, messageCount: 5 },
          { id: 's2', createdAt: 3000, updatedAt: 4000, messageCount: 10 },
        ],
      }),
    );
    renderSessions();

    await waitFor(() => {
      expect(screen.getByText('5 msgs')).toBeTruthy();
      expect(screen.getByText('10 msgs')).toBeTruthy();
    });
  });

  it('shows empty state when no sessions', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ sessions: [] }),
    );
    renderSessions();

    await waitFor(() => {
      expect(screen.getByText('No sessions found')).toBeTruthy();
    });
  });

  it('shows error on failed fetch', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ error: 'Server error' }, false),
    );
    renderSessions();

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeTruthy();
    });
  });

  it('shows Retry button on error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ error: 'Failed' }, false),
    );
    renderSessions();

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeTruthy();
    });
  });

  it('shows detail prompt when no session selected', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ sessions: [] }),
    );
    renderSessions();

    await waitFor(() => {
      expect(screen.getByText('Select a session to view details')).toBeTruthy();
    });
  });
});
