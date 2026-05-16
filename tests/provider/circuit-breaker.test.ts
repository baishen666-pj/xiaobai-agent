import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker } from '../../src/provider/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
  });

  it('starts in closed state', () => {
    expect(cb.getState()).toBe('closed');
    expect(cb.isAvailable()).toBe(true);
  });

  it('stays closed under failure threshold', () => {
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    expect(cb.isAvailable()).toBe(true);
    expect(cb.getFailureCount()).toBe(2);
  });

  it('transitions to open after reaching failure threshold', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.isAvailable()).toBe(false);
  });

  it('resets failure count on success in closed state', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.getState()).toBe('closed');
  });

  it('transitions from open to half-open after reset timeout', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);

    expect(cb.getState()).toBe('half-open');
    expect(cb.isAvailable()).toBe(true);
    vi.useRealTimers();
  });

  it('transitions from half-open to closed on success', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);
    expect(cb.getState()).toBe('half-open');

    cb.beginHalfOpenAttempt();
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
    vi.useRealTimers();
  });

  it('transitions from half-open to open on failure', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);
    expect(cb.getState()).toBe('half-open');

    cb.beginHalfOpenAttempt();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    vi.useRealTimers();
  });

  it('reset clears all state', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.isAvailable()).toBe(true);
  });

  it('respects custom config', () => {
    const custom = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 500 });
    custom.recordFailure();
    expect(custom.getState()).toBe('open');

    vi.useFakeTimers();
    vi.advanceTimersByTime(501);
    expect(custom.getState()).toBe('half-open');
    vi.useRealTimers();
  });

  it('isAvailable returns false while in open state before timeout', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isAvailable()).toBe(false);

    vi.useFakeTimers();
    vi.advanceTimersByTime(500);
    expect(cb.isAvailable()).toBe(false);
    vi.useRealTimers();
  });

  it('getState triggers automatic transition check', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);
    expect(cb.getState()).toBe('half-open');
    vi.useRealTimers();
  });

  it('beginHalfOpenAttempt tracks attempts in half-open', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);

    cb.beginHalfOpenAttempt();
    cb.recordFailure();

    vi.advanceTimersByTime(1001);
    expect(cb.getState()).toBe('half-open');
    vi.useRealTimers();
  });

  it('uses defaults when no config provided', () => {
    const defaultCb = new CircuitBreaker();
    for (let i = 0; i < 4; i++) defaultCb.recordFailure();
    expect(defaultCb.getState()).toBe('closed');
    defaultCb.recordFailure();
    expect(defaultCb.getState()).toBe('open');
  });
});
