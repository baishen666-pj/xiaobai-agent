export interface CredentialLease {
  apiKey: string;
  provider: string;
  leaseId: string;
  acquiredAt: number;
}

interface PoolEntry {
  apiKey: string;
  provider: string;
  rateLimited: boolean;
  rateLimitResetAt: number;
  activeLeases: number;
}

export class CredentialPool {
  private entries: PoolEntry[] = [];
  private activeLeases = new Map<string, { entryIndex: number; acquiredAt: number }>();

  add(provider: string, apiKey: string): void {
    this.entries.push({
      apiKey,
      provider,
      rateLimited: false,
      rateLimitResetAt: 0,
      activeLeases: 0,
    });
  }

  acquire(provider?: string): CredentialLease | null {
    const now = Date.now();
    const candidates = this.entries
      .map((e, i) => ({ entry: e, index: i }))
      .filter(({ entry }) => !provider || entry.provider === provider)
      .filter(({ entry }) => !entry.rateLimited || entry.rateLimitResetAt <= now);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.entry.activeLeases - b.entry.activeLeases);

    const { entry, index } = candidates[0];
    const leaseId = `lease_${now}_${Math.random().toString(36).slice(2, 8)}`;

    entry.activeLeases++;
    this.activeLeases.set(leaseId, { entryIndex: index, acquiredAt: now });

    return {
      apiKey: entry.apiKey,
      provider: entry.provider,
      leaseId,
      acquiredAt: now,
    };
  }

  release(leaseId: string): void {
    const lease = this.activeLeases.get(leaseId);
    if (!lease) return;

    const entry = this.entries[lease.entryIndex];
    if (entry) {
      entry.activeLeases = Math.max(0, entry.activeLeases - 1);
    }
    this.activeLeases.delete(leaseId);
  }

  markRateLimited(apiKey: string, cooldownMs = 60000): void {
    const entry = this.entries.find((e) => e.apiKey === apiKey);
    if (entry) {
      entry.rateLimited = true;
      entry.rateLimitResetAt = Date.now() + cooldownMs;
    }
  }

  getStats(): { total: number; available: number; activeLeases: number; rateLimited: number } {
    const now = Date.now();
    return {
      total: this.entries.length,
      available: this.entries.filter((e) => !e.rateLimited || e.rateLimitResetAt <= now).length,
      activeLeases: this.activeLeases.size,
      rateLimited: this.entries.filter((e) => e.rateLimited && e.rateLimitResetAt > now).length,
    };
  }
}
