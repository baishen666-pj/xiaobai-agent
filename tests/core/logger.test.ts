import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StructuredLogger, BoundLogger, type LogLevel, type LogEntry } from '../../src/core/logger.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `xiaobai-logger-test-${Date.now()}`);

describe('StructuredLogger', () => {
  let logger: StructuredLogger;

  beforeEach(() => {
    logger = new StructuredLogger({ console: false });
  });

  afterEach(() => {
    logger.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should log at info level by default', () => {
    logger.info('test message');
    const entries = logger.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].message).toBe('test message');
    expect(entries[0].level).toBe('info');
  });

  it('should respect log level filtering', () => {
    const debugLogger = new StructuredLogger({ level: 'warn', console: false });
    debugLogger.debug('should not appear');
    debugLogger.info('should not appear');
    debugLogger.warn('should appear');
    debugLogger.error('should appear');

    const entries = debugLogger.getEntries();
    expect(entries.length).toBe(2);
    expect(entries.every((e) => LEVEL_ORDER(e.level) >= LEVEL_ORDER('warn'))).toBe(true);
    debugLogger.close();
  });

  it('should include context in log entries', () => {
    logger.info('user action', { userId: '123', action: 'click' });
    const entries = logger.getEntries();
    expect(entries[0].context).toEqual({ userId: '123', action: 'click' });
  });

  it('should include timestamp in ISO format', () => {
    logger.info('test');
    const entries = logger.getEntries();
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should filter entries by level', () => {
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');

    const errorEntries = logger.getEntries('error');
    expect(errorEntries.length).toBe(1);
    expect(errorEntries[0].level).toBe('error');
  });

  it('should limit returned entries', () => {
    for (let i = 0; i < 100; i++) {
      logger.info(`msg ${i}`);
    }

    const limited = logger.getEntries(undefined, 10);
    expect(limited.length).toBe(10);
    // Should return the last 10
    expect(limited[0].message).toBe('msg 90');
  });

  it('should search entries by message', () => {
    logger.info('hello world');
    logger.info('foo bar');
    logger.info('hello again');

    const results = logger.search('hello');
    expect(results.length).toBe(2);
  });

  it('should search entries by context', () => {
    logger.info('action', { type: 'click' });
    logger.info('action', { type: 'scroll' });

    const results = logger.search('click');
    expect(results.length).toBe(1);
  });

  it('should return stats', () => {
    logger.info('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    const stats = logger.getStats();
    expect(stats.total).toBe(4);
    expect(stats.byLevel.info).toBe(2);
    expect(stats.byLevel.warn).toBe(1);
    expect(stats.byLevel.error).toBe(1);
  });

  it('should write to file', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const filePath = join(TEST_DIR, 'test.log');
    const fileLogger = new StructuredLogger({ console: false, file: true, filePath });
    fileLogger.info('file message');
    fileLogger.flush();

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('file message');
    fileLogger.close();
  });

  it('should support all log levels', () => {
    const allLogger = new StructuredLogger({ level: 'debug', console: false });
    allLogger.debug('debug');
    allLogger.info('info');
    allLogger.warn('warn');
    allLogger.error('error');
    allLogger.fatal('fatal');

    const entries = allLogger.getEntries();
    expect(entries.length).toBe(5);
    const levels = entries.map((e) => e.level);
    expect(levels).toEqual(['debug', 'info', 'warn', 'error', 'fatal']);
    allLogger.close();
  });
});

describe('BoundLogger', () => {
  it('should include bound context in all log calls', () => {
    const logger = new StructuredLogger({ console: false });
    const bound = logger.withContext({ sessionId: 'sess-1' });

    bound.info('test message');
    bound.warn('warning', { extra: 'data' });

    const entries = logger.getEntries();
    expect(entries[0].context?.sessionId).toBe('sess-1');
    expect(entries[1].context?.sessionId).toBe('sess-1');
    expect(entries[1].context?.extra).toBe('data');
    logger.close();
  });

  it('should support all log levels', () => {
    const logger = new StructuredLogger({ level: 'debug', console: false });
    const bound = logger.withContext({ service: 'test' });

    bound.debug('d');
    bound.info('i');
    bound.warn('w');
    bound.error('e');
    bound.fatal('f');

    const entries = logger.getEntries();
    expect(entries.length).toBe(5);
    expect(entries.every((e) => e.context?.service === 'test')).toBe(true);
    logger.close();
  });

  it('should allow extra context to override bound context', () => {
    const logger = new StructuredLogger({ console: false });
    const bound = logger.withContext({ key: 'original' });

    bound.info('override', { key: 'overridden' });

    const entries = logger.getEntries();
    expect(entries[0].context?.key).toBe('overridden');
    logger.close();
  });
});

function LEVEL_ORDER(level: LogLevel): number {
  const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
  return order[level];
}