import { describe, it, expect } from 'vitest';
import { LazyLoader } from '../../src/utils/lazy-loader.js';

describe('LazyLoader', () => {
  it('defers loading until first access', async () => {
    let loadCount = 0;
    const loader = new LazyLoader(async () => {
      loadCount++;
      return { value: 42 };
    });

    expect(loadCount).toBe(0);
    const result = await loader.get();
    expect(loadCount).toBe(1);
    expect(result.value).toBe(42);
  });

  it('caches result on subsequent calls', async () => {
    let loadCount = 0;
    const loader = new LazyLoader(async () => {
      loadCount++;
      return { data: 'cached' };
    });

    await loader.get();
    await loader.get();
    await loader.get();
    expect(loadCount).toBe(1);
  });

  it('propagates errors', async () => {
    const loader = new LazyLoader(async () => {
      throw new Error('load failed');
    });

    await expect(loader.get()).rejects.toThrow('load failed');
  });

  it('caches rejection', async () => {
    let callCount = 0;
    const loader = new LazyLoader(async () => {
      callCount++;
      throw new Error('fail');
    });

    await expect(loader.get()).rejects.toThrow('fail');
    await expect(loader.get()).rejects.toThrow('fail');
    expect(callCount).toBe(1);
  });

  it('reset allows re-loading', async () => {
    let loadCount = 0;
    const loader = new LazyLoader(async () => {
      loadCount++;
      return loadCount;
    });

    expect(await loader.get()).toBe(1);
    loader.reset();
    expect(await loader.get()).toBe(2);
  });
});
