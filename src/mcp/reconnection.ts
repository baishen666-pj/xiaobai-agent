export interface ReconnectionConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_CONFIG: ReconnectionConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

export class ReconnectionManager {
  private config: ReconnectionConfig;
  private attemptCount = 0;

  constructor(config?: Partial<ReconnectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async attempt(callback: () => Promise<boolean>): Promise<boolean> {
    while (this.attemptCount < this.config.maxRetries) {
      this.attemptCount++;
      try {
        const success = await callback();
        if (success) {
          this.attemptCount = 0;
          return true;
        }
      } catch {
        // Callback failed, continue retrying
      }

      if (this.attemptCount >= this.config.maxRetries) break;

      const delay = Math.min(
        this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, this.attemptCount - 1),
        this.config.maxDelayMs,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
    return false;
  }

  reset(): void {
    this.attemptCount = 0;
  }

  getAttemptCount(): number {
    return this.attemptCount;
  }

  getMaxRetries(): number {
    return this.config.maxRetries;
  }
}
