// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RemoteAgentsPage } from '../../../src/dashboard/pages/RemoteAgentsPage.js';
import { DashboardContext } from '../../../src/dashboard/hooks/useDashboardContext.js';
import { createMockContext } from '../helpers/mockContext.js';

function renderRemoteAgents(overrides?: Record<string, unknown>) {
  const ctx = createMockContext({
    wsUrl: 'ws://localhost:3001',
    ...overrides,
  });
  return render(
    <DashboardContext.Provider value={ctx}>
      <MemoryRouter>
        <RemoteAgentsPage />
      </MemoryRouter>
    </DashboardContext.Provider>,
  );
}

describe('RemoteAgentsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/agents/register')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes('/api/agents/') && url.includes('DELETE')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({
        agents: [
          { name: 'remote-1', protocol: 'a2a', url: 'http://localhost:5001', role: 'researcher' },
          { name: 'remote-2', protocol: 'acp', url: 'http://localhost:5002', role: 'coder' },
        ],
      }), { status: 200 });
    }));
  });

  it('renders page header', () => {
    renderRemoteAgents();
    expect(screen.getByText('Remote Agents')).toBeTruthy();
  });

  it('shows loading state initially', () => {
    renderRemoteAgents();
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders register form', () => {
    renderRemoteAgents();
    expect(screen.getByText('Register Agent')).toBeTruthy();
    expect(screen.getByPlaceholderText('Name')).toBeTruthy();
    expect(screen.getByPlaceholderText('URL')).toBeTruthy();
  });

  it('renders agents table after loading', async () => {
    renderRemoteAgents();

    await waitFor(() => {
      expect(screen.getByText('remote-1')).toBeTruthy();
    });

    expect(screen.getByText('remote-2')).toBeTruthy();
    expect(screen.getByText('researcher')).toBeTruthy();
  });

  it('shows empty state when no agents', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ agents: [] }), { status: 200 })
    ));

    renderRemoteAgents();

    await waitFor(() => {
      expect(screen.getByText('No remote agents registered.')).toBeTruthy();
    });
  });

  it('displays protocol badges', async () => {
    renderRemoteAgents();

    await waitFor(() => {
      expect(screen.getByText('A2A')).toBeTruthy();
      expect(screen.getByText('ACP')).toBeTruthy();
    });
  });

  it('shows remove buttons for each agent', async () => {
    renderRemoteAgents();

    await waitFor(() => {
      expect(screen.getByText('remote-1')).toBeTruthy();
    });

    const removeButtons = screen.getAllByText('Remove');
    expect(removeButtons).toHaveLength(2);
  });

  it('handles fetch error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('error', { status: 500 })
    ));

    renderRemoteAgents();

    await waitFor(() => {
      expect(screen.getByText('HTTP 500')).toBeTruthy();
    });
  });
});
