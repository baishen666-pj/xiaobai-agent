import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from '../../src/session/manager.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-session-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SessionManager', () => {
  it('creates sessions directory on construction', () => {
    const dir = join(tempDir, 'new-sessions');
    new SessionManager(dir);
    expect(existsSync(join(dir, 'sessions'))).toBe(true);
  });

  it('createSession returns a session ID', () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    expect(id).toMatch(/^session_\d+_[a-f0-9]{8}$/);
  });

  it('createSession persists an empty message array', () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const path = join(tempDir, 'sessions', `${id}.json`);
    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    expect(content).toEqual([]);
  });

  it('loadMessages throws for invalid session ID', async () => {
    const sm = new SessionManager(tempDir);
    await expect(sm.loadMessages('nonexistent')).rejects.toThrow('Invalid session ID');
  });

  it('saveMessages and loadMessages round-trip', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const messages = [
      { role: 'user' as const, content: 'Hello', timestamp: Date.now() },
      { role: 'assistant' as const, content: 'Hi!', timestamp: Date.now() },
    ];
    await sm.saveMessages(id, messages);
    const loaded = await sm.loadMessages(id);
    expect(loaded).toEqual(messages);
  });

  it('loadMessages handles corrupted JSON gracefully', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const path = join(tempDir, 'sessions', `${id}.json`);
    writeFileSync(path, 'not valid json{{{', 'utf-8');
    const messages = await sm.loadMessages(id);
    expect(messages).toEqual([]);
  });

  it('listSessions returns empty array when no sessions', async () => {
    const sm = new SessionManager(tempDir);
    const sessions = await sm.listSessions();
    expect(sessions).toEqual([]);
  });

  it('listSessions returns session metadata', async () => {
    const sm = new SessionManager(tempDir);
    const now = Date.now();
    const id = sm.createSession();
    await sm.saveMessages(id, [
      { role: 'user' as const, content: 'test', timestamp: now },
      { role: 'assistant' as const, content: 'ok', timestamp: now + 1000 },
    ]);
    const sessions = await sm.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(id);
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[0].createdAt).toBe(now);
    expect(sessions[0].updatedAt).toBe(now + 1000);
  });

  it('listSessions sorts by updatedAt descending', async () => {
    const sm = new SessionManager(tempDir);
    const id1 = sm.createSession();
    const id2 = sm.createSession();
    await sm.saveMessages(id1, [{ role: 'user' as const, content: 'a', timestamp: 1000 }]);
    await sm.saveMessages(id2, [{ role: 'user' as const, content: 'b', timestamp: 2000 }]);
    const sessions = await sm.listSessions();
    expect(sessions[0].id).toBe(id2);
    expect(sessions[1].id).toBe(id1);
  });

  it('listSessions handles corrupted session files gracefully', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const path = join(tempDir, 'sessions', `${id}.json`);
    writeFileSync(path, 'bad json', 'utf-8');
    const sessions = await sm.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(id);
    expect(sessions[0].messageCount).toBe(0);
  });

  it('deleteSession removes the session file', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const result = await sm.deleteSession(id);
    expect(result).toBe(true);
    expect((await sm.listSessions())).toHaveLength(0);
  });

  it('deleteSession throws for invalid session ID', async () => {
    const sm = new SessionManager(tempDir);
    await expect(sm.deleteSession('nonexistent')).rejects.toThrow('Invalid session ID');
  });

  it('createSession generates unique IDs', () => {
    const sm = new SessionManager(tempDir);
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      ids.add(sm.createSession());
    }
    expect(ids.size).toBe(10);
  });

  it('rejects path traversal in session ID', async () => {
    const sm = new SessionManager(tempDir);
    await expect(sm.loadMessages('../../../etc/passwd')).rejects.toThrow('Invalid session ID');
    await expect(sm.saveMessages('../../../etc/passwd', [])).rejects.toThrow('Invalid session ID');
    await expect(sm.deleteSession('../../../etc/passwd')).rejects.toThrow('Invalid session ID');
  });

  it('rejects empty session ID', async () => {
    const sm = new SessionManager(tempDir);
    await expect(sm.loadMessages('')).rejects.toThrow('Invalid session ID');
  });

  it('saveSessionState and loadSessionState round-trip', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const state = {
      sessionId: id,
      messages: [{ role: 'user' as const, content: 'test', timestamp: 1000 }],
      turn: 1,
      totalTokens: 50,
      lastCompactTokens: 0,
      model: 'gpt-4',
      provider: 'openai',
      createdAt: 1000,
      updatedAt: 2000,
    };
    await sm.saveSessionState(id, state);
    const loaded = await sm.loadSessionState(id);
    expect(loaded?.sessionId).toBe(id);
    expect(loaded?.turn).toBe(1);
    expect(loaded?.totalTokens).toBe(50);
    expect(loaded?.model).toBe('gpt-4');
    expect(loaded?.provider).toBe('openai');
    expect(loaded?.messages).toHaveLength(1);
  });

  it('saveSessionState merges with existing state', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    await sm.saveMessages(id, [{ role: 'user' as const, content: 'hello', timestamp: 100 }]);
    await sm.saveSessionState(id, { turn: 5, totalTokens: 100 });
    const loaded = await sm.loadSessionState(id);
    expect(loaded?.turn).toBe(5);
    expect(loaded?.totalTokens).toBe(100);
    expect(loaded?.messages).toHaveLength(1);
  });

  it('loadSessionState returns null for invalid format', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const path = join(tempDir, 'sessions', `${id}.json`);
    writeFileSync(path, JSON.stringify({ foo: 'bar' }), 'utf-8');
    const loaded = await sm.loadSessionState(id);
    expect(loaded).toBeNull();
  });

  it('loadSessionState returns null for unreadable file', async () => {
    const sm = new SessionManager(tempDir);
    const loaded = await sm.loadSessionState('session_00000000_00000000');
    expect(loaded).toBeNull();
  });

  it('loadSessionState handles old array format backward compat', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const path = join(tempDir, 'sessions', `${id}.json`);
    writeFileSync(path, JSON.stringify([
      { role: 'user', content: 'hi', timestamp: 100 },
      { role: 'assistant', content: 'hey', timestamp: 200 },
    ]), 'utf-8');
    const loaded = await sm.loadSessionState(id);
    expect(loaded?.sessionId).toBe(id);
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.createdAt).toBe(100);
    expect(loaded?.updatedAt).toBe(200);
    expect(loaded?.turn).toBe(0);
  });

  it('deleteSession returns false for non-existent file', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    await sm.deleteSession(id);
    const result = await sm.deleteSession(id);
    expect(result).toBe(false);
  });

  it('getLatestSession returns null when no sessions', async () => {
    const sm = new SessionManager(tempDir);
    const result = await sm.getLatestSession();
    expect(result).toBeNull();
  });

  it('getLatestSession returns most recent session', async () => {
    const sm = new SessionManager(tempDir);
    const id1 = sm.createSession();
    const id2 = sm.createSession();
    await sm.saveMessages(id1, [{ role: 'user' as const, content: 'a', timestamp: 1000 }]);
    await sm.saveMessages(id2, [{ role: 'user' as const, content: 'b', timestamp: 2000 }]);
    const latest = await sm.getLatestSession();
    expect(latest).toBe(id2);
  });

  it('extractSessionMetadata handles unknown format', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const path = join(tempDir, 'sessions', `${id}.json`);
    writeFileSync(path, JSON.stringify('just a string'), 'utf-8');
    const sessions = await sm.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(id);
    expect(sessions[0].messageCount).toBe(0);
  });

  it('loadMessages reads messages after saveSessionState changes format', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();

    // Simulate what AgentLoop does: save full state after a turn
    await sm.saveSessionState(id, {
      sessionId: id,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      turn: 1,
      totalTokens: 42,
      lastCompactTokens: 0,
    });

    // loadMessages should extract the messages array from SessionState format
    const messages = await sm.loadMessages(id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].content).toBe('Hi there!');
  });

  it('saveSessionState rejects invalid session ID', async () => {
    const sm = new SessionManager(tempDir);
    await expect(sm.saveSessionState('nonexistent', { turn: 1 })).rejects.toThrow('Invalid session ID');
  });

  it('loadSessionState rejects invalid session ID', async () => {
    const sm = new SessionManager(tempDir);
    await expect(sm.loadSessionState('nonexistent')).rejects.toThrow('Invalid session ID');
  });
});
