import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool_result';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  timestamp?: number;
}

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  totalTokens: number;
}

export interface SessionState {
  sessionId: string;
  messages: Message[];
  turn: number;
  totalTokens: number;
  lastCompactTokens: number;
  model?: string;
  provider?: string;
  createdAt: number;
  updatedAt: number;
}

const SAFE_SESSION_ID = /^session_\d+_[a-f0-9]{8}$/;

export class SessionManager {
  private sessionsDir: string;

  constructor(configDir: string) {
    this.sessionsDir = join(configDir, 'sessions');
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  // Sync by design — callers expect an immediate ID to use in subsequent async calls
  createSession(): string {
    const id = `session_${Date.now()}_${randomBytes(4).toString('hex')}`;
    writeFileSync(this.getSessionPath(id), JSON.stringify([], null, 2), 'utf-8');
    return id;
  }

  async loadMessages(sessionId: string): Promise<Message[]> {
    this.validateSessionId(sessionId);
    const path = this.getSessionPath(sessionId);
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw);
      if (this.isSessionState(parsed)) {
        return (parsed as SessionState).messages;
      }
      if (Array.isArray(parsed)) {
        return parsed as Message[];
      }
      return [];
    } catch {
      return [];
    }
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    this.validateSessionId(sessionId);
    const path = this.getSessionPath(sessionId);
    await writeFile(path, JSON.stringify(messages, null, 2), 'utf-8');
  }

  async listSessions(): Promise<Session[]> {
    try {
      const files = await readdir(this.sessionsDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      const sessions: Session[] = [];

      for (const f of jsonFiles) {
        const id = f.replace('.json', '');
        try {
          const raw = await readFile(join(this.sessionsDir, f), 'utf-8');
          const parsed = JSON.parse(raw);
          sessions.push(this.extractSessionMetadata(id, parsed));
        } catch {
          sessions.push({ id, createdAt: 0, updatedAt: 0, messageCount: 0, totalTokens: 0 });
        }
      }

      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async saveSessionState(sessionId: string, state: Partial<SessionState>): Promise<void> {
    this.validateSessionId(sessionId);
    const path = this.getSessionPath(sessionId);

    let existing: Partial<SessionState> = {};
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw);
      existing = this.isSessionState(parsed) ? parsed : { messages: parsed };
    } catch {
      existing = { messages: [] };
    }

    const merged: SessionState = {
      sessionId,
      messages: state.messages ?? existing.messages ?? [],
      turn: state.turn ?? existing.turn ?? 0,
      totalTokens: state.totalTokens ?? existing.totalTokens ?? 0,
      lastCompactTokens: state.lastCompactTokens ?? existing.lastCompactTokens ?? 0,
      model: state.model ?? existing.model,
      provider: state.provider ?? existing.provider,
      createdAt: existing.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    await writeFile(path, JSON.stringify(merged, null, 2), 'utf-8');
  }

  async loadSessionState(sessionId: string): Promise<SessionState | null> {
    this.validateSessionId(sessionId);
    const path = this.getSessionPath(sessionId);
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw);

      if (this.isSessionState(parsed)) {
        return parsed as SessionState;
      }

      // Backward compatibility: old format is just Message[]
      if (Array.isArray(parsed)) {
        return {
          sessionId,
          messages: parsed,
          turn: 0,
          totalTokens: 0,
          lastCompactTokens: 0,
          createdAt: parsed[0]?.timestamp ?? 0,
          updatedAt: parsed[parsed.length - 1]?.timestamp ?? 0,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  async getLatestSession(): Promise<string | null> {
    const sessions = await this.listSessions();
    if (sessions.length === 0) return null;
    return sessions[0].id;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    this.validateSessionId(sessionId);
    const path = this.getSessionPath(sessionId);
    try {
      await unlink(path);
      return true;
    } catch {
      return false;
    }
  }

  private validateSessionId(sessionId: string): void {
    if (!SAFE_SESSION_ID.test(sessionId)) {
      throw new Error(`Invalid session ID: ${sessionId.slice(0, 20)}`);
    }
  }

  private isSessionState(parsed: unknown): parsed is SessionState {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const obj = parsed as Record<string, unknown>;
    return typeof obj.sessionId === 'string' && Array.isArray(obj.messages);
  }

  private extractSessionMetadata(id: string, parsed: unknown): Session {
    if (this.isSessionState(parsed)) {
      return {
        id,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
        messageCount: parsed.messages.length,
        totalTokens: parsed.totalTokens,
      };
    }
    if (Array.isArray(parsed)) {
      const msgs = parsed as Message[];
      return {
        id,
        createdAt: msgs[0]?.timestamp ?? 0,
        updatedAt: msgs[msgs.length - 1]?.timestamp ?? 0,
        messageCount: msgs.length,
        totalTokens: 0,
      };
    }
    return { id, createdAt: 0, updatedAt: 0, messageCount: 0, totalTokens: 0 };
  }

  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }
}
