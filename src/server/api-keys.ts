import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface ApiKeyEntry {
  name: string;
  hash: string;
  scopes: string[];
  created: number;
  lastUsed?: number;
}

export class ApiKeyManager {
  private keys = new Map<string, ApiKeyEntry>();
  private filePath: string;

  constructor(configDir: string) {
    this.filePath = join(configDir, 'api-keys.json');
  }

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      for (const entry of data) {
        this.keys.set(entry.name, entry);
      }
    } catch {
      // Ignore invalid file
    }
  }

  async save(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = [...this.keys.values()];
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  create(name: string, scopes: string[]): string {
    const raw = `xai_${Date.now()}_${randomBytes(8).toString('hex')}`;
    const hash = this.hash(raw);

    this.keys.set(name, {
      name,
      hash,
      scopes,
      created: Date.now(),
    });

    void this.save();
    return raw;
  }

  validate(key: string): ApiKeyEntry | null {
    const hash = this.hash(key);
    for (const entry of this.keys.values()) {
      if (timingSafeEqual(Buffer.from(hash), Buffer.from(entry.hash))) {
        entry.lastUsed = Date.now();
        return entry;
      }
    }
    return null;
  }

  revoke(name: string): boolean {
    if (!this.keys.has(name)) return false;
    this.keys.delete(name);
    void this.save();
    return true;
  }

  list(): Array<{ name: string; scopes: string[]; created: number; lastUsed?: number }> {
    return [...this.keys.values()].map(({ name, scopes, created, lastUsed }) => ({
      name, scopes, created, lastUsed,
    }));
  }

  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}
