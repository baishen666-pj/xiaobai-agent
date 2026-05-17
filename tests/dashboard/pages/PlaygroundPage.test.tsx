// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlaygroundPage } from '../../../src/dashboard/pages/PlaygroundPage.js';
import { DashboardContext } from '../../../src/dashboard/hooks/useDashboardContext.js';
import { createMockContext } from '../helpers/mockContext.js';

function mockFetchResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response);
}

function renderPlayground() {
  const ctx = createMockContext();
  return render(
    <DashboardContext.Provider value={ctx}>
      <MemoryRouter>
        <PlaygroundPage />
      </MemoryRouter>
    </DashboardContext.Provider>,
  );
}

describe('PlaygroundPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders page header', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/models')) return mockFetchResponse({ providers: [] });
      if (url.includes('/tools')) return mockFetchResponse({ tools: [] });
      if (url.includes('/plugins')) return mockFetchResponse({ plugins: [] });
      return mockFetchResponse({});
    });
    await waitFor(() => {
      renderPlayground();
    });
    expect(screen.getByText('Playground')).toBeTruthy();
  });

  it('renders resource tabs', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/models')) return mockFetchResponse({ providers: [] });
      if (url.includes('/tools')) return mockFetchResponse({ tools: [] });
      if (url.includes('/plugins')) return mockFetchResponse({ plugins: [] });
      return mockFetchResponse({});
    });
    await waitFor(() => {
      renderPlayground();
    });
    const tabs = screen.getAllByText(/^(models|tools|plugins)$/);
    expect(tabs.length).toBeGreaterThanOrEqual(3);
  });

  it('loads and displays models in resource list', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/models')) return mockFetchResponse({ providers: ['openai', 'anthropic'] });
      if (url.includes('/tools')) return mockFetchResponse({ tools: [] });
      if (url.includes('/plugins')) return mockFetchResponse({ plugins: [] });
      return mockFetchResponse({});
    });
    renderPlayground();

    await waitFor(() => {
      const list = screen.getByRole('list');
      expect(list.textContent).toContain('openai');
      expect(list.textContent).toContain('anthropic');
    });
  });

  it('renders chat input and buttons', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/models')) return mockFetchResponse({ providers: [] });
      if (url.includes('/tools')) return mockFetchResponse({ tools: [] });
      if (url.includes('/plugins')) return mockFetchResponse({ plugins: [] });
      return mockFetchResponse({});
    });
    await waitFor(() => {
      renderPlayground();
    });
    expect(screen.getByPlaceholderText('Type a message...')).toBeTruthy();
    expect(screen.getByText('Send')).toBeTruthy();
    expect(screen.getByText('Stream')).toBeTruthy();
  });

  it('shows empty chat state', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/models')) return mockFetchResponse({ providers: [] });
      if (url.includes('/tools')) return mockFetchResponse({ tools: [] });
      if (url.includes('/plugins')) return mockFetchResponse({ plugins: [] });
      return mockFetchResponse({});
    });
    await waitFor(() => {
      renderPlayground();
    });
    expect(screen.getByText('Send a message to start chatting')).toBeTruthy();
  });
});
