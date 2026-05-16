import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryBackend } from './mem0-adapter.js';

export type MemoryScope = 'session' | 'state' | 'long-term';

interface MemoryEntry {
  content: string;
  addedAt: number;
  scope: MemoryScope;
}

export class MemorySystem {
  private memoryDir: string;
  private stateEntries: MemoryEntry[] = [];
  private longTermEntries: MemoryEntry[] = [];
  private sessionEntries: MemoryEntry[] = [];
  private frozenSnapshot: string | null = null;
  private dirty = false;
  private memoryCharLimit: number;
  private userCharLimit: number;
  private backend?: MemoryBackend;
  private persistSessionEnabled: boolean;

  constructor(configDir: string, memoryCharLimit = 2200, userCharLimit = 1375, backend?: MemoryBackend, persistSession = false) {
    this.memoryDir = join(configDir, 'memories');
    this.memoryCharLimit = memoryCharLimit;
    this.userCharLimit = userCharLimit;
    this.backend = backend;
    this.persistSessionEnabled = persistSession;
    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
    }
    if (!backend) {
      this.load();
    }
  }

  private load(): void {
    this.stateEntries = this.loadFile('STATE.md', 'state');
    this.longTermEntries = this.loadFile('MEMORY.md', 'long-term');
    this.sessionEntries = [];
  }

  private loadFile(filename: string, scope: MemoryScope): MemoryEntry[] {
    const path = join(this.memoryDir, filename);
    if (!existsSync(path)) return [];
    const content = readFileSync(path, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => ({ content: line, addedAt: Date.now(), scope }));
  }

  private saveFile(filename: string, entries: MemoryEntry[]): void {
    const path = join(this.memoryDir, filename);
    writeFileSync(path, entries.map((e) => e.content).join('\n'), 'utf-8');
  }

  // ── Frozen snapshot pattern (from Hermes) ──
  // Memory is injected once at session start and never mutated mid-session.
  // Changes persist to disk but only appear in the next session.

  freeze(): void {
    const blocks: string[] = [];

    if (this.longTermEntries.length > 0) {
      const chars = this.longTermEntries.reduce((s, e) => s + e.content.length, 0);
      blocks.push(
        `══ MEMORY (${Math.round((chars / this.memoryCharLimit) * 100)}% — ${chars}/${this.memoryCharLimit} chars) ══`,
        this.longTermEntries.map((e) => e.content).join('\n'),
      );
    }

    if (this.stateEntries.length > 0) {
      const stateChars = this.stateEntries.reduce((s, e) => s + e.content.length, 0);
      blocks.push(
        `══ USER PROFILE (${Math.round((stateChars / this.userCharLimit) * 100)}% — ${stateChars}/${this.userCharLimit} chars) ══`,
        this.stateEntries.map((e) => e.content).join('\n'),
      );
    }

    this.frozenSnapshot = blocks.length > 0 ? blocks.join('\n\n') : null;
  }

  getFrozenSnapshot(): string | null {
    return this.frozenSnapshot;
  }

  // ── Unified memory API ──

  add(scopeOrTarget: MemoryScope | 'memory' | 'user', content: string): { success: boolean; error?: string } {
    const scope = this.resolveScope(scopeOrTarget);

    if (this.backend) {
      const result = this.backend.add(scope, content);
      return result instanceof Promise
        ? { success: true }
        : result;
    }

    const entries = this.getEntries(scope);
    const limit = scope === 'state' ? this.userCharLimit : this.memoryCharLimit;
    const currentChars = entries.reduce((sum, e) => sum + e.content.length, 0);

    if (currentChars + content.length > limit) {
      return {
        success: false,
        error: `${scope} at ${currentChars}/${limit} chars. Adding ${content.length} chars exceeds limit.`,
      };
    }

    if (entries.some((e) => e.content === content)) return { success: true };

    entries.push({ content, addedAt: Date.now(), scope });
    this.dirty = true;
    this.persist(scope);
    return { success: true };
  }

  remove(scopeOrTarget: MemoryScope | 'memory' | 'user', oldText: string): { success: boolean; error?: string } {
    const scope = this.resolveScope(scopeOrTarget);

    if (this.backend) {
      const result = this.backend.remove(scope, oldText);
      return result instanceof Promise
        ? { success: true }
        : result;
    }

    const entries = this.getEntries(scope);
    const matches = entries.filter((e) => e.content.includes(oldText));

    if (matches.length === 0) return { success: false, error: 'No matching entry found' };
    if (matches.length > 1) return { success: false, error: 'Multiple matches, be more specific' };

    entries.splice(entries.indexOf(matches[0]), 1);
    this.dirty = true;
    this.persist(scope);
    return { success: true };
  }

  replace(scopeOrTarget: MemoryScope | 'memory' | 'user', oldText: string, newContent: string): { success: boolean; error?: string } {
    const scope = this.resolveScope(scopeOrTarget);

    if (this.backend) {
      const result = this.backend.replace(scope, oldText, newContent);
      return result instanceof Promise
        ? { success: true }
        : result;
    }

    const entries = this.getEntries(scope);
    const matches = entries.filter((e) => e.content.includes(oldText));

    if (matches.length === 0) return { success: false, error: 'No matching entry found' };
    if (matches.length > 1) return { success: false, error: 'Multiple matches, be more specific' };

    const idx = entries.indexOf(matches[0]);
    entries[idx] = { content: newContent, addedAt: Date.now(), scope };
    this.dirty = true;
    this.persist(scope);
    return { success: true };
  }

  list(scopeOrTarget: MemoryScope | 'memory' | 'user'): string[] {
    if (this.backend) {
      const result = this.backend.list(this.resolveScope(scopeOrTarget));
      if (result instanceof Promise) return [];
      return result;
    }
    return this.getEntries(this.resolveScope(scopeOrTarget)).map((e) => e.content);
  }

  private resolveScope(scopeOrTarget: MemoryScope | 'memory' | 'user'): MemoryScope {
    if (scopeOrTarget === 'memory') return 'long-term';
    if (scopeOrTarget === 'user') return 'state';
    return scopeOrTarget;
  }

  private getEntries(scope: MemoryScope): MemoryEntry[] {
    switch (scope) {
      case 'session': return this.sessionEntries;
      case 'state': return this.stateEntries;
      case 'long-term': return this.longTermEntries;
    }
  }

  private persist(scope: MemoryScope): void {
    switch (scope) {
      case 'state':
        this.saveFile('STATE.md', this.stateEntries);
        break;
      case 'long-term':
        this.saveFile('MEMORY.md', this.longTermEntries);
        break;
      case 'session':
        if (this.persistSessionEnabled) {
          this.saveFile('SESSION.md', this.sessionEntries);
        }
        break;
    }
  }

  async getSystemPromptBlock(): Promise<string | null> {
    if (this.frozenSnapshot) return this.frozenSnapshot;

    const blocks: string[] = [];

    if (this.longTermEntries.length > 0) {
      const memChars = this.longTermEntries.reduce((s, e) => s + e.content.length, 0);
      blocks.push(
        `══ MEMORY (${Math.round((memChars / this.memoryCharLimit) * 100)}% — ${memChars}/${this.memoryCharLimit} chars) ══`,
        this.longTermEntries.map((e) => e.content).join('\n'),
      );
    }

    if (this.stateEntries.length > 0) {
      const stateChars = this.stateEntries.reduce((s, e) => s + e.content.length, 0);
      blocks.push(
        `══ USER PROFILE (${Math.round((stateChars / this.userCharLimit) * 100)}% — ${stateChars}/${this.userCharLimit} chars) ══`,
        this.stateEntries.map((e) => e.content).join('\n'),
      );
    }

    return blocks.length > 0 ? blocks.join('\n\n') : null;
  }

  async flushIfDirty(): Promise<void> {
    if (this.backend) {
      await this.backend.flush();
      return;
    }
    if (!this.dirty) return;
    this.saveFile('MEMORY.md', this.longTermEntries);
    this.saveFile('STATE.md', this.stateEntries);
    if (this.persistSessionEnabled) {
      this.saveFile('SESSION.md', this.sessionEntries);
    }
    this.dirty = false;
  }

  getUsage(): { memory: { used: number; limit: number }; user: { used: number; limit: number } } {
    return {
      memory: {
        used: this.longTermEntries.reduce((s, e) => s + e.content.length, 0),
        limit: this.memoryCharLimit,
      },
      user: {
        used: this.stateEntries.reduce((s, e) => s + e.content.length, 0),
        limit: this.userCharLimit,
      },
    };
  }

  clearSession(): void {
    this.sessionEntries = [];
    if (this.persistSessionEnabled) {
      this.saveFile('SESSION.md', this.sessionEntries);
    }
  }
}
