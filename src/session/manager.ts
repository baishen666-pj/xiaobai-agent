import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

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
    const id = `session_${Date.now()}_${createHash('md5').update(Math.random().toString()).digest('hex').slice(0, 8)}`;
    writeFileSync(this.getSessionPath(id), JSON.stringify([], null, 2), 'utf-8');
    return id;
  }

  async loadMessages(sessionId: string): Promise<Message[]> {
    this.validateSessionId(sessionId);
    const path = this.getSessionPath(sessionId);
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as Message[];
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
        try {
          const raw = await readFile(join(this.sessionsDir, f), 'utf-8');
          const messages = JSON.parse(raw) as Message[];
          sessions.push({
            id: f.replace('.json', ''),
            createdAt: messages[0]?.timestamp ?? 0,
            updatedAt: messages[messages.length - 1]?.timestamp ?? 0,
            messageCount: messages.length,
            totalTokens: 0,
          });
        } catch {
          sessions.push({ id: f.replace('.json', ''), createdAt: 0, updatedAt: 0, messageCount: 0, totalTokens: 0 });
        }
      }

      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
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

  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }
}
