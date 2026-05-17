import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient, type ApiError } from '../../src/dashboard/lib/api.js';

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('createApiClient', () => {
  let client: ReturnType<typeof createApiClient>;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    client = createApiClient();
  });

  it('listSessions calls GET /api/sessions', async () => {
    const body = { sessions: [{ id: 's1', createdAt: 0, updatedAt: 0, messageCount: 5 }] };
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse(body));

    const result = await client.listSessions();
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith('/api/sessions', { signal: undefined });
  });

  it('getSession calls GET /api/sessions/:id', async () => {
    const body = { session: { id: 's1', messages: [] } };
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse(body));

    const result = await client.getSession('s1');
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith('/api/sessions/s1', { signal: undefined });
  });

  it('deleteSession calls DELETE /api/sessions/:id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse({ deleted: true }));

    const result = await client.deleteSession('s1');
    expect(result).toEqual({ deleted: true });
    expect(fetch).toHaveBeenCalledWith('/api/sessions/s1', {
      method: 'DELETE',
      signal: undefined,
    });
  });

  it('getModels calls GET /api/models', async () => {
    const body = { providers: ['openai', 'anthropic'] };
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse(body));

    const result = await client.getModels();
    expect(result).toEqual(body);
  });

  it('getTools calls GET /api/tools', async () => {
    const body = { tools: [{ name: 'search', description: 'Search tool' }] };
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse(body));

    const result = await client.getTools();
    expect(result).toEqual(body);
  });

  it('getPlugins calls GET /api/plugins', async () => {
    const body = { plugins: [{ name: 'demo' }] };
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse(body));

    const result = await client.getPlugins();
    expect(result).toEqual(body);
  });

  it('listWorkflows calls GET /api/workflows', async () => {
    const body = { workflows: [{ name: 'deploy', version: '1.0', stepCount: 3 }] };
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse(body));

    const result = await client.listWorkflows();
    expect(result).toEqual(body);
  });

  it('runWorkflow calls POST /api/workflows/:name/run', async () => {
    const body = { runId: 'r1', status: 'completed', stepResults: {}, startedAt: 0 };
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse(body));

    const result = await client.runWorkflow('deploy', { env: 'prod' });
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith('/api/workflows/deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { env: 'prod' } }),
      signal: undefined,
    });
  });

  it('chat calls POST /api/chat', async () => {
    const body = { content: 'Hello!', model: 'gpt-4', timestamp: 1000 };
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse(body));

    const result = await client.chat('Hi', { model: 'gpt-4' });
    expect(result).toEqual(body);
    expect(JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)).toEqual({
      message: 'Hi',
      model: 'gpt-4',
    });
  });

  it('health calls GET /health', async () => {
    const body = { status: 'healthy', timestamp: 0, uptime: 100, version: '0.6.0', checks: {}, details: {} };
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse(body));

    const result = await client.health();
    expect(result.status).toBe('healthy');
  });

  it('liveness calls GET /health/live', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse({ alive: true, uptime: 100 }));

    const result = await client.liveness();
    expect(result.alive).toBe(true);
  });

  it('readiness calls GET /health/ready', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse({ ready: true, checks: {} }));

    const result = await client.readiness();
    expect(result.ready).toBe(true);
  });

  it('throws ApiError on non-2xx response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ error: 'Not found' }, false, 404),
    );

    await expect(client.getSession('bad')).rejects.toEqual({ error: 'Not found' });
  });

  it('throws fallback error when error body is not JSON', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('invalid json')),
    } as Response);

    await expect(client.health()).rejects.toEqual({ error: 'HTTP 500' });
  });

  it('forwards AbortSignal', async () => {
    const controller = new AbortController();
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse({ sessions: [] }));

    await client.listSessions(controller.signal);
    expect(fetch).toHaveBeenCalledWith('/api/sessions', { signal: controller.signal });
  });

  it('encodes special characters in session id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockFetchResponse({ session: { id: 'a/b' } }),
    );

    await client.getSession('a/b');
    expect(fetch).toHaveBeenCalledWith('/api/sessions/a%2Fb', { signal: undefined });
  });

  it('uses custom basePath', async () => {
    const customClient = createApiClient('http://localhost:3001');
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(mockFetchResponse({ sessions: [] }));

    await customClient.listSessions();
    expect(fetch).toHaveBeenCalledWith('http://localhost:3001/api/sessions', { signal: undefined });
  });
});
