import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

export class SessionManager {
  private sessionsDir: string;

  constructor(configDir: string) {
    this.sessionsDir = join(configDir, 'sessions');
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  createSession(): string {
    const id = `session_${Date.now()}_${createHash('md5').update(Math.random().toString()).digest('hex').slice(0, 8)}`;
    writeFileSync(this.getSessionPath(id), JSON.stringify([], null, 2), 'utf-8');
    return id;
  }

  async loadMessages(sessionId: string): Promise<Message[]> {
    const path = this.getSessionPath(sessionId);
    if (!existsSync(path)) return [];
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as Message[];
    } catch {
      return [];
    }
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    const path = this.getSessionPath(sessionId);
    const dir = join(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(messages, null, 2), 'utf-8');
  }

  listSessions(): Session[] {
    if (!existsSync(this.sessionsDir)) return [];
    const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      try {
        const raw = readFileSync(join(this.sessionsDir, f), 'utf-8');
        const messages = JSON.parse(raw) as Message[];
        return {
          id: f.replace('.json', ''),
          createdAt: messages[0]?.timestamp ?? 0,
          updatedAt: messages[messages.length - 1]?.timestamp ?? 0,
          messageCount: messages.length,
          totalTokens: 0,
        };
      } catch {
        return { id: f.replace('.json', ''), createdAt: 0, updatedAt: 0, messageCount: 0, totalTokens: 0 };
      }
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  deleteSession(sessionId: string): boolean {
    const path = this.getSessionPath(sessionId);
    if (!existsSync(path)) return false;
    try {
      const { unlinkSync } = require('node:fs');
      unlinkSync(path);
      return true;
    } catch {
      return false;
    }
  }

  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }
}
