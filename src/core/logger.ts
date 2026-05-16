import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  sessionId?: string;
  turn?: number;
  source?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  console: boolean;
  consoleFormat: 'pretty' | 'json';
  file: boolean;
  filePath?: string;
  maxFileSize?: number;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1B[36m',  // cyan
  info: '\x1B[32m',   // green
  warn: '\x1B[33m',   // yellow
  error: '\x1B[31m',  // red
  fatal: '\x1B[35m',  // magenta
};

const RESET = '\x1B[0m';

export class StructuredLogger {
  private config: LoggerConfig;
  private entries: LogEntry[] = [];
  private fileBuffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: config?.level ?? 'info',
      console: config?.console ?? true,
      consoleFormat: config?.consoleFormat ?? 'pretty',
      file: config?.file ?? false,
      filePath: config?.filePath,
      maxFileSize: config?.maxFileSize ?? 10 * 1024 * 1024,
    };

    if (this.config.file && this.config.filePath) {
      const dir = join(this.config.filePath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this.flushTimer = setInterval(() => this.flush(), 5000);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log('fatal', message, context);
  }

  withContext(ctx: Record<string, unknown>): BoundLogger {
    return new BoundLogger(this, ctx);
  }

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.config.level]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    this.entries.push(entry);

    if (this.config.console) {
      this.writeConsole(entry);
    }

    if (this.config.file) {
      this.writeFile(entry);
    }
  }

  getEntries(level?: LogLevel, limit?: number): LogEntry[] {
    const filtered = level
      ? this.entries.filter((e) => LEVEL_ORDER[e.level] >= LEVEL_ORDER[level])
      : this.entries;
    const result = limit ? filtered.slice(-limit) : filtered;
    return [...result];
  }

  search(query: string, limit: number = 50): LogEntry[] {
    const lower = query.toLowerCase();
    const results = this.entries.filter((e) =>
      e.message.toLowerCase().includes(lower) ||
      (e.context && JSON.stringify(e.context).toLowerCase().includes(lower)),
    );
    return results.slice(-limit);
  }

  getStats(): { total: number; byLevel: Record<LogLevel, number>; since: string } {
    const byLevel: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
    for (const entry of this.entries) {
      byLevel[entry.level]++;
    }

    return {
      total: this.entries.length,
      byLevel,
      since: this.entries[0]?.timestamp ?? new Date().toISOString(),
    };
  }

  flush(): void {
    if (this.fileBuffer.length === 0) return;

    if (this.config.filePath) {
      const content = this.fileBuffer.join('\n') + '\n';
      try {
        writeFileSync(this.config.filePath, content, { encoding: 'utf-8', flag: 'a' });
      } catch {
        // Silently fail — logging should never crash the app
      }
      this.fileBuffer = [];
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private writeConsole(entry: LogEntry): void {
    if (this.config.consoleFormat === 'json') {
      console.log(JSON.stringify(entry));
      return;
    }

    const color = LEVEL_COLORS[entry.level];
    const levelTag = `${color}[${entry.level.toUpperCase()}]${RESET}`;
    const timeTag = `\x1B[90m${entry.timestamp.slice(11, 19)}${RESET}`;
    const ctxStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';

    console.log(`${timeTag} ${levelTag} ${entry.message}${ctxStr}`);
  }

  private writeFile(entry: LogEntry): void {
    this.fileBuffer.push(JSON.stringify(entry));
  }
}

export class BoundLogger {
  private logger: StructuredLogger;
  private context: Record<string, unknown>;

  constructor(logger: StructuredLogger, context: Record<string, unknown>) {
    this.logger = logger;
    this.context = context;
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    this.logger.debug(message, { ...this.context, ...extra });
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.logger.info(message, { ...this.context, ...extra });
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.logger.warn(message, { ...this.context, ...extra });
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.logger.error(message, { ...this.context, ...extra });
  }

  fatal(message: string, extra?: Record<string, unknown>): void {
    this.logger.fatal(message, { ...this.context, ...extra });
  }
}