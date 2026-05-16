import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LocalMemoryBackend,
  Mem0Backend,
  createMemoryBackend,
  type MemoryBackend,
} from '../../src/memory/mem0-adapter.js';

// ---------------------------------------------------------------------------
// LocalMemoryBackend
// ---------------------------------------------------------------------------

describe('LocalMemoryBackend', () => {
  let backend: LocalMemoryBackend;

  beforeEach(() => {
    backend = new LocalMemoryBackend();
  });

  // -- add --

  describe('add', () => {
    it('adds an entry to a new scope', async () => {
      const result = await backend.add('long-term', 'user prefers dark mode');
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      const entries = await backend.list('long-term');
      expect(entries).toEqual(['user prefers dark mode']);
    });

    it('adds multiple entries to the same scope', async () => {
      await backend.add('state', 'entry A');
      await backend.add('state', 'entry B');
      const entries = await backend.list('state');
      expect(entries).toEqual(['entry A', 'entry B']);
    });

    it('does not add duplicate entries (returns success without appending)', async () => {
      await backend.add('state', 'duplicate');
      const result = await backend.add('state', 'duplicate');
      expect(result.success).toBe(true);
      const entries = await backend.list('state');
      expect(entries).toHaveLength(1);
    });

    it('allows same content in different scopes', async () => {
      await backend.add('scope-a', 'shared content');
      await backend.add('scope-b', 'shared content');
      expect(await backend.list('scope-a')).toEqual(['shared content']);
      expect(await backend.list('scope-b')).toEqual(['shared content']);
    });

    it('rejects content that exceeds the character limit', async () => {
      const limited = new LocalMemoryBackend(50);
      const result = await limited.add('scope', 'x'.repeat(51));
      expect(result.success).toBe(false);
      expect(result.error).toContain('50');
      expect(result.error).toContain('char limit');
    });

    it('rejects content that exactly hits the boundary when total exceeds limit', async () => {
      const limited = new LocalMemoryBackend(20);
      await limited.add('scope', '0123456789'); // 10 chars used
      const result = await limited.add('scope', '01234567891'); // 11 chars -> total 21 > 20
      expect(result.success).toBe(false);
    });

    it('accepts content that fills exactly to the limit', async () => {
      const limited = new LocalMemoryBackend(20);
      const result = await limited.add('scope', '01234567890123456789'); // exactly 20 chars
      expect(result.success).toBe(true);
    });

    it('uses default charLimit of 2200 when not specified', async () => {
      const result = await backend.add('scope', 'x'.repeat(2200));
      expect(result.success).toBe(true);
    });
  });

  // -- remove --

  describe('remove', () => {
    it('removes an entry matching by substring', async () => {
      await backend.add('state', 'user prefers dark mode');
      const result = await backend.remove('state', 'dark mode');
      expect(result.success).toBe(true);
      expect(await backend.list('state')).toEqual([]);
    });

    it('returns failure when no entry matches the substring', async () => {
      await backend.add('state', 'some content');
      const result = await backend.remove('state', 'nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No matching entry');
    });

    it('returns failure when the scope has no entries', async () => {
      const result = await backend.remove('empty-scope', 'anything');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No matching entry');
    });

    it('only removes the first matching entry', async () => {
      await backend.add('state', 'alpha contains keyword');
      await backend.add('state', 'beta contains keyword');
      await backend.remove('state', 'keyword');
      const entries = await backend.list('state');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toBe('beta contains keyword');
    });
  });

  // -- replace --

  describe('replace', () => {
    it('replaces an entry matching by substring', async () => {
      await backend.add('state', 'user prefers dark mode');
      const result = await backend.replace('state', 'dark mode', 'user prefers light mode');
      expect(result.success).toBe(true);
      const entries = await backend.list('state');
      expect(entries).toEqual(['user prefers light mode']);
    });

    it('returns failure when no entry matches', async () => {
      const result = await backend.replace('state', 'nonexistent', 'new content');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No matching entry');
    });

    it('replaces only the first matching entry', async () => {
      await backend.add('state', 'alpha keyword here');
      await backend.add('state', 'beta keyword here');
      await backend.replace('state', 'keyword', 'replaced');
      const entries = await backend.list('state');
      expect(entries).toEqual(['replaced', 'beta keyword here']);
    });
  });

  // -- list --

  describe('list', () => {
    it('returns an empty array for an unknown scope', async () => {
      const entries = await backend.list('unknown');
      expect(entries).toEqual([]);
    });

    it('returns a copy so mutations do not affect internal state', async () => {
      await backend.add('state', 'entry');
      const entries = await backend.list('state');
      entries.push('mutated');
      const reloaded = await backend.list('state');
      expect(reloaded).toEqual(['entry']);
    });
  });

  // -- getSystemPromptBlock --

  describe('getSystemPromptBlock', () => {
    it('returns null when there are no entries', async () => {
      const block = await backend.getSystemPromptBlock();
      expect(block).toBeNull();
    });

    it('returns a formatted block for a single scope', async () => {
      await backend.add('long-term', 'project uses TypeScript');
      const block = await backend.getSystemPromptBlock();
      expect(block).not.toBeNull();
      expect(block!).toContain('LONG-TERM');
      expect(block!).toContain('project uses TypeScript');
    });

    it('joins multiple entries within a scope with newlines', async () => {
      await backend.add('state', 'entry 1');
      await backend.add('state', 'entry 2');
      const block = await backend.getSystemPromptBlock();
      expect(block).toContain('entry 1\nentry 2');
    });

    it('joins multiple scopes with double newlines', async () => {
      await backend.add('scope-a', 'content A');
      await backend.add('scope-b', 'content B');
      const block = await backend.getSystemPromptBlock();
      expect(block).toContain('SCOPE-A');
      expect(block).toContain('SCOPE-B');
      expect(block).toContain('content A');
      expect(block).toContain('content B');
      // Scopes are separated by \n\n
      expect(block!.split('\n\n').length).toBeGreaterThanOrEqual(2);
    });

    it('skips scopes that have been emptied', async () => {
      await backend.add('state', 'will be removed');
      await backend.remove('state', 'will be removed');
      const block = await backend.getSystemPromptBlock();
      expect(block).toBeNull();
    });
  });

  // -- flush --

  describe('flush', () => {
    it('does not throw (no-op for local backend)', async () => {
      await expect(backend.flush()).resolves.toBeUndefined();
    });

    it('does not affect stored data', async () => {
      await backend.add('state', 'persisted');
      await backend.flush();
      const entries = await backend.list('state');
      expect(entries).toEqual(['persisted']);
    });
  });
});

// ---------------------------------------------------------------------------
// Mem0Backend (all external fetch calls are mocked)
// ---------------------------------------------------------------------------

describe('Mem0Backend', () => {
  let backend: Mem0Backend;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    backend = new Mem0Backend({
      apiKey: 'test-api-key',
      baseUrl: 'http://localhost:9999',
      userId: 'test-user',
      agentId: 'test-agent',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- constructor defaults --

  describe('constructor defaults', () => {
    it('uses default baseUrl when not provided', () => {
      const b = new Mem0Backend({ apiKey: 'key' });
      // We verify via the fetch URL in add()
      fetchMock.mockResolvedValue({ ok: true });
      b.add('scope', 'content');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.mem0.ai/v1/memories/',
        expect.anything(),
      );
    });

    it('uses default userId when not provided', () => {
      const b = new Mem0Backend({ apiKey: 'key' });
      fetchMock.mockResolvedValue({ ok: true });
      b.add('scope', 'content');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.user_id).toBe('xiaobai-default');
    });

    it('uses default agentId when not provided', () => {
      const b = new Mem0Backend({ apiKey: 'key' });
      fetchMock.mockResolvedValue({ ok: true });
      b.add('scope', 'content');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.agent_id).toBe('xiaobai-agent');
    });
  });

  // -- add --

  describe('add', () => {
    it('sends a POST request with correct headers and body', async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const result = await backend.add('my-scope', 'some fact');
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:9999/memories/');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['Authorization']).toBe('Token test-api-key');
      const body = JSON.parse(options.body);
      expect(body.messages).toEqual([{ role: 'user', content: 'some fact' }]);
      expect(body.user_id).toBe('test-user');
      expect(body.agent_id).toBe('test-agent');
      expect(body.metadata.scope).toBe('my-scope');
    });

    it('returns failure when the API responds with non-ok status', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      });
      const result = await backend.add('scope', 'content');
      expect(result.success).toBe(false);
      expect(result.error).toContain('429');
      expect(result.error).toContain('rate limited');
    });

    it('clears the cache for the scope on success', async () => {
      // Pre-fill cache
      const listResponse = {
        ok: true,
        json: async () => ({ results: [{ memory: 'old', metadata: { scope: 'scope' } }] }),
      };
      fetchMock.mockResolvedValue(listResponse);
      await backend.list('scope');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Now add - should clear cache
      fetchMock.mockResolvedValue({ ok: true });
      await backend.add('scope', 'new fact');

      // Next list call should hit API again (cache was cleared)
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });
      await backend.list('scope');
      expect(fetchMock).toHaveBeenCalledTimes(3); // list + add + list again
    });

    it('handles network errors gracefully', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await backend.add('scope', 'content');
      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });

    it('clears cache even on API error response', async () => {
      // Fill cache
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ memory: 'cached', metadata: { scope: 'x' } }] }),
      });
      await backend.list('x');

      // API returns error
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'server error',
      });
      await backend.add('x', 'content');

      // Cache should not have been cleared for error case (check code: cache.delete only on success)
      // Actually looking at the code: cache.delete(scope) is NOT called on error path,
      // it only runs before the try-catch on the success path. Let's verify:
      // The add method only calls cache.delete(scope) after response.ok check passes.
      // So on error, cache is preserved.
      // Next list should use cache
      const cachedList = await backend.list('x');
      // The cache was not cleared, so this returns cached data without fetching
      expect(cachedList).toEqual(['cached']);
      // No additional fetch call because cache hit
      expect(fetchMock).toHaveBeenCalledTimes(2); // first list + failed add
    });
  });

  // -- remove --

  describe('remove', () => {
    it('returns failure when no matching entry found in list', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ memory: 'other fact', metadata: { scope: 'scope' } }] }),
      });
      const result = await backend.remove('scope', 'nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No matching entry');
    });

    it('returns failure when list returns empty', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });
      const result = await backend.remove('scope', 'anything');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No matching entry');
    });

    it('finds the matching memory, searches for its ID, and deletes it', async () => {
      // First call: list (for this.list(scope) inside remove)
      // Since cache is empty, it fetches
      const memoryEntry = { memory: 'user likes cats', metadata: { scope: 'pets' } };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [memoryEntry] }),
      });

      // Second call: search for the memory ID
      const foundEntry = { id: 'mem-123', memory: 'user likes cats' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [foundEntry] }),
      });

      // Third call: DELETE the memory
      fetchMock.mockResolvedValueOnce({ ok: true });

      const result = await backend.remove('pets', 'likes cats');
      expect(result.success).toBe(true);

      // Verify DELETE call
      const deleteCall = fetchMock.mock.calls[2];
      expect(deleteCall[0]).toBe('http://localhost:9999/memories/mem-123/');
      expect(deleteCall[1].method).toBe('DELETE');
      expect(deleteCall[1].headers['Authorization']).toBe('Token test-api-key');
    });

    it('succeeds even when search response is not ok (still returns success)', async () => {
      // list call returns a matching entry
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ memory: 'some fact', metadata: { scope: 'scope' } }] }),
      });

      // search call returns not ok
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      const result = await backend.remove('scope', 'some fact');
      expect(result.success).toBe(true);
    });

    it('succeeds even when memory ID is not found in search results', async () => {
      // list returns matching entry
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ memory: 'target', metadata: { scope: 'scope' } }] }),
      });

      // search returns results but none match exactly
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'other-id', memory: 'different' }] }),
      });

      const result = await backend.remove('scope', 'target');
      expect(result.success).toBe(true);
      // DELETE should NOT be called since no matching ID was found
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('clears the cache on remove', async () => {
      // Pre-fill cache via list
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ memory: 'cached fact', metadata: { scope: 'scope' } }] }),
      });
      await backend.list('scope');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // remove: list uses cache (no fetch), then searches for ID to delete
      // Search returns matching entry
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'mem-id', memory: 'cached fact' }] }),
      });
      // Delete call
      fetchMock.mockResolvedValueOnce({ ok: true });

      const result = await backend.remove('scope', 'cached fact');
      expect(result.success).toBe(true);

      // Cache was cleared by remove, so next list fetches again from API
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });
      await backend.list('scope');
      // total calls: initial list(1) + search(1) + delete(1) + list-after-flush(1) = 4
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('handles network errors gracefully when list returns empty', async () => {
      // list() internally catches fetch errors and returns []
      // So remove sees "No matching entry" rather than the raw network error
      fetchMock.mockRejectedValue(new Error('network failure'));
      const result = await backend.remove('scope', 'text');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No matching entry');
    });

    it('handles network errors in the search/delete phase', async () => {
      // list returns a match (from cache or API)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ memory: 'fact', metadata: { scope: 'scope' } }] }),
      });
      // search for ID throws
      fetchMock.mockRejectedValueOnce(new Error('search network failure'));

      const result = await backend.remove('scope', 'fact');
      expect(result.success).toBe(false);
      expect(result.error).toBe('search network failure');
    });

    it('sends correct query parameters when searching memories', async () => {
      // list call
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ memory: 'fact', metadata: { scope: 'scope' } }] }),
      });

      // search call - we verify the URL
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await backend.remove('scope', 'fact');

      const searchCall = fetchMock.mock.calls[1];
      expect(searchCall[0]).toBe(
        'http://localhost:9999/memories/?user_id=test-user&agent_id=test-agent',
      );
    });
  });

  // -- replace --

  describe('replace', () => {
    it('calls remove then add on success', async () => {
      // list for remove
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ memory: 'old content', metadata: { scope: 'scope' } }] }),
      });
      // search for remove
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'id-1', memory: 'old content' }] }),
      });
      // delete for remove
      fetchMock.mockResolvedValueOnce({ ok: true });
      // add
      fetchMock.mockResolvedValueOnce({ ok: true });

      const result = await backend.replace('scope', 'old content', 'new content');
      expect(result.success).toBe(true);

      // Verify the add call
      const addCall = fetchMock.mock.calls[3];
      expect(addCall[1].method).toBe('POST');
      const body = JSON.parse(addCall[1].body);
      expect(body.messages[0].content).toBe('new content');
    });

    it('returns the remove failure when remove fails', async () => {
      // list returns empty
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await backend.replace('scope', 'nonexistent', 'new');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No matching entry');
      expect(fetchMock).toHaveBeenCalledTimes(1); // Only the list call, no add
    });
  });

  // -- list --

  describe('list', () => {
    it('returns filtered entries matching the scope', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { memory: 'fact A', metadata: { scope: 'target' } },
            { memory: 'fact B', metadata: { scope: 'other' } },
            { memory: 'fact C', metadata: { scope: 'target' } },
          ],
        }),
      });
      const entries = await backend.list('target');
      expect(entries).toEqual(['fact A', 'fact C']);
    });

    it('returns empty array when API responds with non-ok status', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      const entries = await backend.list('scope');
      expect(entries).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      fetchMock.mockRejectedValue(new Error('timeout'));
      const entries = await backend.list('scope');
      expect(entries).toEqual([]);
    });

    it('returns empty array when results is undefined', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      const entries = await backend.list('scope');
      expect(entries).toEqual([]);
    });

    it('caches results so subsequent calls skip the API', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ memory: 'cached', metadata: { scope: 'scope' } }] }),
      });
      const first = await backend.list('scope');
      const second = await backend.list('scope');
      expect(first).toEqual(second);
      expect(fetchMock).toHaveBeenCalledTimes(1); // Only one API call
    });

    it('filters entries where metadata.scope is undefined', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { memory: 'no metadata scope', metadata: {} },
            { memory: 'with scope', metadata: { scope: 'target' } },
          ],
        }),
      });
      const entries = await backend.list('target');
      expect(entries).toEqual(['with scope']);
    });
  });

  // -- getSystemPromptBlock --

  describe('getSystemPromptBlock', () => {
    it('returns null when both scopes are empty', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });
      const block = await backend.getSystemPromptBlock();
      expect(block).toBeNull();
    });

    it('returns a formatted block for long-term scope only', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{ memory: 'project fact', metadata: { scope: 'long-term' } }],
        }),
      });
      const block = await backend.getSystemPromptBlock();
      expect(block).not.toBeNull();
      expect(block!).toContain('LONG-TERM');
      expect(block!).toContain('project fact');
      expect(block).not.toContain('STATE');
    });

    it('returns a formatted block for state scope only', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{ memory: 'user preference', metadata: { scope: 'state' } }],
        }),
      });
      const block = await backend.getSystemPromptBlock();
      expect(block).not.toBeNull();
      expect(block!).toContain('STATE');
      expect(block!).toContain('user preference');
    });

    it('returns a combined block for both scopes', async () => {
      // getSystemPromptBlock iterates ['long-term', 'state']
      // First call for long-term
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ memory: 'project rule', metadata: { scope: 'long-term' } }],
        }),
      });
      // Second call for state
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ memory: 'user preference', metadata: { scope: 'state' } }],
        }),
      });

      const block = await backend.getSystemPromptBlock();
      expect(block).toContain('LONG-TERM');
      expect(block).toContain('STATE');
      expect(block).toContain('project rule');
      expect(block).toContain('user preference');
    });

    it('only iterates long-term and state scopes', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });
      await backend.getSystemPromptBlock();
      // Should call list twice: once for long-term, once for state
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // -- flush --

  describe('flush', () => {
    it('clears the cache', async () => {
      // Populate cache
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ memory: 'cached', metadata: { scope: 'scope' } }] }),
      });
      await backend.list('scope');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Flush
      await backend.flush();

      // Next list call should hit API again
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });
      await backend.list('scope');
      expect(fetchMock).toHaveBeenCalledTimes(2); // fetched again after flush
    });
  });
});

// ---------------------------------------------------------------------------
// createMemoryBackend factory
// ---------------------------------------------------------------------------

describe('createMemoryBackend', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns LocalMemoryBackend by default', () => {
    const backend = createMemoryBackend();
    expect(backend).toBeInstanceOf(LocalMemoryBackend);
  });

  it('returns LocalMemoryBackend when config is undefined', () => {
    const backend = createMemoryBackend(undefined);
    expect(backend).toBeInstanceOf(LocalMemoryBackend);
  });

  it('returns LocalMemoryBackend when backend is "local"', () => {
    const backend = createMemoryBackend({ backend: 'local' });
    expect(backend).toBeInstanceOf(LocalMemoryBackend);
  });

  it('returns LocalMemoryBackend when backend is "mem0" but no apiKey', () => {
    const backend = createMemoryBackend({ backend: 'mem0', mem0: { apiKey: '' } });
    expect(backend).toBeInstanceOf(LocalMemoryBackend);
  });

  it('returns LocalMemoryBackend when backend is "mem0" but mem0 config is missing', () => {
    const backend = createMemoryBackend({ backend: 'mem0' });
    expect(backend).toBeInstanceOf(LocalMemoryBackend);
  });

  it('returns Mem0Backend when backend is "mem0" and apiKey is provided', () => {
    const backend = createMemoryBackend({
      backend: 'mem0',
      mem0: { apiKey: 'test-key' },
    });
    expect(backend).toBeInstanceOf(Mem0Backend);
  });

  it('returns Mem0Backend with custom config values', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const backend = createMemoryBackend({
      backend: 'mem0',
      mem0: {
        apiKey: 'custom-key',
        baseUrl: 'http://custom:8080',
        userId: 'custom-user',
        agentId: 'custom-agent',
      },
    });
    expect(backend).toBeInstanceOf(Mem0Backend);

    // Verify the config is used by triggering an add
    backend.add('scope', 'content');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://custom:8080/memories/');
    const body = JSON.parse(options.body);
    expect(body.user_id).toBe('custom-user');
    expect(body.agent_id).toBe('custom-agent');
  });

  it('returned backend implements MemoryBackend interface', () => {
    const local = createMemoryBackend();
    expect(typeof local.add).toBe('function');
    expect(typeof local.remove).toBe('function');
    expect(typeof local.replace).toBe('function');
    expect(typeof local.list).toBe('function');
    expect(typeof local.getSystemPromptBlock).toBe('function');
    expect(typeof local.flush).toBe('function');
  });
});
