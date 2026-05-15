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

  it('listSessions returns empty array when no sessions', () => {
    const sm = new SessionManager(tempDir);
    expect(sm.listSessions()).toEqual([]);
  });

  it('listSessions returns session metadata', async () => {
    const sm = new SessionManager(tempDir);
    const now = Date.now();
    const id = sm.createSession();
    await sm.saveMessages(id, [
      { role: 'user' as const, content: 'test', timestamp: now },
      { role: 'assistant' as const, content: 'ok', timestamp: now + 1000 },
    ]);
    const sessions = sm.listSessions();
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
    const sessions = sm.listSessions();
    expect(sessions[0].id).toBe(id2);
    expect(sessions[1].id).toBe(id1);
  });

  it('listSessions handles corrupted session files gracefully', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const path = join(tempDir, 'sessions', `${id}.json`);
    writeFileSync(path, 'bad json', 'utf-8');
    const sessions = sm.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(id);
    expect(sessions[0].messageCount).toBe(0);
  });

  it('deleteSession removes the session file', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const result = sm.deleteSession(id);
    expect(result).toBe(true);
    expect(sm.listSessions()).toHaveLength(0);
  });

  it('deleteSession throws for invalid session ID', () => {
    const sm = new SessionManager(tempDir);
    expect(() => sm.deleteSession('nonexistent')).toThrow('Invalid session ID');
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
    expect(() => sm.deleteSession('../../../etc/passwd')).toThrow('Invalid session ID');
  });

  it('rejects empty session ID', async () => {
    const sm = new SessionManager(tempDir);
    await expect(sm.loadMessages('')).rejects.toThrow('Invalid session ID');
  });
});
