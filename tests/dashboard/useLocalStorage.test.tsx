// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from '../../src/dashboard/hooks/useLocalStorage.js';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns default value when key is not set', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('returns stored value when key exists', () => {
    localStorage.setItem('test-key', JSON.stringify('stored'));
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
    expect(result.current[0]).toBe('stored');
  });

  it('returns default when stored value is invalid JSON', () => {
    localStorage.setItem('test-key', 'not-json');
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('removes corrupted key from localStorage', () => {
    localStorage.setItem('test-key', 'not-json');
    renderHook(() => useLocalStorage('test-key', 'default'));
    expect(localStorage.getItem('test-key')).toBeNull();
  });

  it('sets value via setter function', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));
    act(() => { result.current[1]('updated'); });
    expect(result.current[0]).toBe('updated');
    expect(JSON.parse(localStorage.getItem('test-key')!)).toBe('updated');
  });

  it('sets value via updater function', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 0));
    act(() => { result.current[1]((prev) => prev + 1); });
    expect(result.current[0]).toBe(1);
    expect(JSON.parse(localStorage.getItem('test-key')!)).toBe(1);
  });

  it('persists objects', () => {
    const { result } = renderHook(() => useLocalStorage('obj', { a: 1 }));
    act(() => { result.current[1]({ a: 2, b: 3 }); });
    expect(result.current[0]).toEqual({ a: 2, b: 3 });
  });

  it('handles multiple independent keys', () => {
    const hook1 = renderHook(() => useLocalStorage('key1', 'v1'));
    const hook2 = renderHook(() => useLocalStorage('key2', 'v2'));
    act(() => { hook1.result.current[1]('updated1'); });
    expect(hook1.result.current[0]).toBe('updated1');
    expect(hook2.result.current[0]).toBe('v2');
  });

  it('handles boolean values', () => {
    const { result } = renderHook(() => useLocalStorage('bool', false));
    act(() => { result.current[1](true); });
    expect(result.current[0]).toBe(true);
  });

  it('handles array values', () => {
    const { result } = renderHook(() => useLocalStorage<string[]>('arr', []));
    act(() => { result.current[1]((prev) => [...prev, 'a', 'b']); });
    expect(result.current[0]).toEqual(['a', 'b']);
  });

  it('gracefully handles localStorage.setItem failure', () => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
    const { result } = renderHook(() => useLocalStorage('fail-key', 'initial'));
    act(() => { result.current[1]('new-value'); });
    expect(result.current[0]).toBe('new-value');
    localStorage.setItem = original;
  });
});
