// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HealthPage } from '../../../src/dashboard/pages/HealthPage.js';
import { DashboardContext } from '../../../src/dashboard/hooks/useDashboardContext.js';
import { createMockContext } from '../helpers/mockContext.js';

function mockFetchResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response);
}

const mockHealth = {
  status: 'healthy',
  timestamp: 1000,
  uptime: 60000,
  version: '0.6.0',
  checks: {
    provider: { status: 'healthy', latencyMs: 5, detail: '2 providers' },
    memory: { status: 'healthy', latencyMs: 1, detail: '10 entries' },
  },
  details: {},
};

const mockLiveness = { alive: true, uptime: 60000 };
const mockReadiness = { ready: true, checks: {} };

function setupFetchMocks(healthOverride = mockHealth) {
  (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url.includes('/health/ready')) return mockFetchResponse(mockReadiness);
    if (url.includes('/health/live')) return mockFetchResponse(mockLiveness);
    return mockFetchResponse(healthOverride);
  });
}

function renderHealth() {
  const ctx = createMockContext();
  return render(
    <DashboardContext.Provider value={ctx}>
      <MemoryRouter>
        <HealthPage />
      </MemoryRouter>
    </DashboardContext.Provider>,
  );
}

describe('HealthPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders page header', async () => {
    setupFetchMocks();
    await act(async () => { renderHealth(); });
    expect(screen.getByText('System Health')).toBeTruthy();
  });

  it('displays overall health status', async () => {
    setupFetchMocks();
    await act(async () => { renderHealth(); });

    await waitFor(() => {
      expect(screen.getByText('HEALTHY')).toBeTruthy();
    });
  });

  it('displays subsystem cards', async () => {
    setupFetchMocks();
    await act(async () => { renderHealth(); });

    await waitFor(() => {
      expect(screen.getByText('provider')).toBeTruthy();
      expect(screen.getByText('memory')).toBeTruthy();
      expect(screen.getByText('2 providers')).toBeTruthy();
      expect(screen.getByText('10 entries')).toBeTruthy();
    });
  });

  it('displays liveness and readiness probes', async () => {
    setupFetchMocks();
    await act(async () => { renderHealth(); });

    await waitFor(() => {
      expect(screen.getByText('ALIVE')).toBeTruthy();
      expect(screen.getByText('READY')).toBeTruthy();
    });
  });

  it('shows degraded status', async () => {
    const degradedHealth = {
      ...mockHealth,
      status: 'degraded' as const,
      checks: {
        provider: { status: 'degraded' as const, latencyMs: 0, detail: 'No provider' },
      },
    };
    setupFetchMocks(degradedHealth);
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/health/ready')) return mockFetchResponse({ ready: false, checks: {} });
      if (url.includes('/health/live')) return mockFetchResponse(mockLiveness);
      return mockFetchResponse(degradedHealth);
    });

    await act(async () => { renderHealth(); });

    await waitFor(() => {
      expect(screen.getByText('DEGRADED')).toBeTruthy();
      expect(screen.getByText('NOT READY')).toBeTruthy();
    });
  });

  it('shows raw JSON toggle', async () => {
    setupFetchMocks();
    await act(async () => { renderHealth(); });

    await waitFor(() => {
      expect(screen.getByText('Show Raw JSON')).toBeTruthy();
    });
  });
});
