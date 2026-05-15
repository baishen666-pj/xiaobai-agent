import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface MemoryEntry {
  content: string;
  addedAt: number;
}

export class MemorySystem {
  private memoryDir: string;
  private memoryEntries: MemoryEntry[] = [];
  private userEntries: MemoryEntry[] = [];
  private dirty = false;
  private memoryCharLimit: number;
  private userCharLimit: number;

  constructor(configDir: string, memoryCharLimit = 2200, userCharLimit = 1375) {
    this.memoryDir = join(configDir, 'memories');
    this.memoryCharLimit = memoryCharLimit;
    this.userCharLimit = userCharLimit;
    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
    }
    this.load();
  }

  private load(): void {
    this.memoryEntries = this.loadFile('MEMORY.md');
    this.userEntries = this.loadFile('USER.md');
  }

  private loadFile(filename: string): MemoryEntry[] {
    const path = join(this.memoryDir, filename);
    if (!existsSync(path)) return [];
    const content = readFileSync(path, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => ({ content: line, addedAt: Date.now() }));
  }

  private saveFile(filename: string, entries: MemoryEntry[]): void {
    const path = join(this.memoryDir, filename);
    writeFileSync(path, entries.map((e) => e.content).join('\n'), 'utf-8');
  }

  add(target: 'memory' | 'user', content: string): { success: boolean; error?: string } {
    const entries = target === 'memory' ? this.memoryEntries : this.userEntries;
    const limit = target === 'memory' ? this.memoryCharLimit : this.userCharLimit;
    const currentChars = entries.reduce((sum, e) => sum + e.content.length, 0);

    if (currentChars + content.length > limit) {
      return {
        success: false,
        error: `${target} at ${currentChars}/${limit} chars. Adding ${content.length} chars exceeds limit.`,
      };
    }

    if (entries.some((e) => e.content === content)) {
      return { success: true };
    }

    entries.push({ content, addedAt: Date.now() });
    this.dirty = true;
    this.saveFile(target === 'memory' ? 'MEMORY.md' : 'USER.md', entries);
    return { success: true };
  }

  replace(target: 'memory' | 'user', oldText: string, newContent: string): { success: boolean; error?: string } {
    const entries = target === 'memory' ? this.memoryEntries : this.userEntries;
    const matches = entries.filter((e) => e.content.includes(oldText));

    if (matches.length === 0) return { success: false, error: 'No matching entry found' };
    if (matches.length > 1) return { success: false, error: 'Multiple matches, be more specific' };

    const idx = entries.indexOf(matches[0]);
    entries[idx] = { content: newContent, addedAt: Date.now() };
    this.dirty = true;
    this.saveFile(target === 'memory' ? 'MEMORY.md' : 'USER.md', entries);
    return { success: true };
  }

  remove(target: 'memory' | 'user', oldText: string): { success: boolean; error?: string } {
    const entries = target === 'memory' ? this.memoryEntries : this.userEntries;
    const matches = entries.filter((e) => e.content.includes(oldText));

    if (matches.length === 0) return { success: false, error: 'No matching entry found' };
    if (matches.length > 1) return { success: false, error: 'Multiple matches, be more specific' };

    entries.splice(entries.indexOf(matches[0]), 1);
    this.dirty = true;
    this.saveFile(target === 'memory' ? 'MEMORY.md' : 'USER.md', entries);
    return { success: true };
  }

  list(target: 'memory' | 'user'): string[] {
    const entries = target === 'memory' ? this.memoryEntries : this.userEntries;
    return entries.map((e) => e.content);
  }

  async getSystemPromptBlock(): Promise<string | null> {
    const blocks: string[] = [];

    if (this.memoryEntries.length > 0) {
      const memChars = this.memoryEntries.reduce((s, e) => s + e.content.length, 0);
      blocks.push(
        `══ MEMORY (${Math.round((memChars / this.memoryCharLimit) * 100)}% — ${memChars}/${this.memoryCharLimit} chars) ══`,
        this.memoryEntries.map((e) => e.content).join('\n'),
      );
    }

    if (this.userEntries.length > 0) {
      const userChars = this.userEntries.reduce((s, e) => s + e.content.length, 0);
      blocks.push(
        `══ USER PROFILE (${Math.round((userChars / this.userCharLimit) * 100)}% — ${userChars}/${this.userCharLimit} chars) ══`,
        this.userEntries.map((e) => e.content).join('\n'),
      );
    }

    return blocks.length > 0 ? blocks.join('\n\n') : null;
  }

  async flushIfDirty(): Promise<void> {
    if (!this.dirty) return;
    this.saveFile('MEMORY.md', this.memoryEntries);
    this.saveFile('USER.md', this.userEntries);
    this.dirty = false;
  }

  getUsage(): { memory: { used: number; limit: number }; user: { used: number; limit: number } } {
    return {
      memory: {
        used: this.memoryEntries.reduce((s, e) => s + e.content.length, 0),
        limit: this.memoryCharLimit,
      },
      user: {
        used: this.userEntries.reduce((s, e) => s + e.content.length, 0),
        limit: this.userCharLimit,
      },
    };
  }
}
