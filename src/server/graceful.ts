export interface Shutdownable {
  name: string;
  stop(): Promise<void>;
}

export class GracefulShutdown {
  private components: Shutdownable[] = [];
  private shuttingDown = false;
  private timeoutMs: number;
  private handlers: Array<() => void> = [];
  private startTime = 0;

  constructor(timeoutMs = 30000) {
    this.timeoutMs = timeoutMs;
  }

  register(component: Shutdownable): void {
    this.components.push(component);
  }

  install(): () => void {
    const handler = () => { void this.shutdown('signal'); };
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

    for (const sig of signals) {
      process.on(sig, handler);
      this.handlers.push(() => process.off(sig, handler));
    }

    if (process.platform !== 'win32') {
      const sighup = () => { void this.shutdown('sighup'); };
      process.on('SIGHUP', sighup);
      this.handlers.push(() => process.off('SIGHUP', sighup));
    }

    return () => {
      for (const off of this.handlers) off();
      this.handlers = [];
    };
  }

  async shutdown(reason: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.startTime = Date.now();

    console.log(`[shutdown] Starting graceful shutdown (reason: ${reason})`);

    const timeout = setTimeout(() => {
      console.error('[shutdown] Timeout reached, forcing exit');
      process.exit(1);
    }, this.timeoutMs);

    try {
      for (const component of this.components) {
        try {
          await component.stop();
          console.log(`[shutdown] Stopped ${component.name}`);
        } catch (err) {
          console.error(`[shutdown] Error stopping ${component.name}:`, err);
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const elapsed = Date.now() - this.startTime;
    console.log(`[shutdown] Complete in ${elapsed}ms`);
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}
