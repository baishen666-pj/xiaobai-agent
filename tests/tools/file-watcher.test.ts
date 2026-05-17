import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watch } from 'node:fs';
import type { FSWatcher, WatchListener } from 'node:fs';

const mockClose = vi.fn();
let capturedListener: WatchListener<string> | undefined;

vi.mock('node:fs', () => ({
  watch: vi.fn((_rootDir: string, _opts: object, listener: WatchListener<string>) => {
    capturedListener = listener;
    return { close: mockClose } as unknown as FSWatcher;
  }),
}));

import { FileWatcher } from '../../src/tools/file-watcher.js';

const mockedWatch = vi.mocked(watch);

describe('FileWatcher', () => {
  let watcher: FileWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    capturedListener = undefined;
    mockClose.mockReset();
    mockedWatch.mockClear();
    mockedWatch.mockImplementation((_rootDir: string, _opts: object, listener: WatchListener<string>) => {
      capturedListener = listener;
      return { close: mockClose } as unknown as FSWatcher;
    });
  });

  afterEach(() => {
    watcher?.stop();
    vi.useRealTimers();
  });

  describe('start', () => {
    it('should create a recursive watcher on start', () => {
      watcher = new FileWatcher({ rootDir: '/project' });
      watcher.start();

      expect(mockedWatch).toHaveBeenCalledWith('/project', { recursive: true }, expect.any(Function));
    });

    it('should not create a second watcher if already started', () => {
      watcher = new FileWatcher({ rootDir: '/project' });
      watcher.start();
      watcher.start();

      expect(mockedWatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('extension filtering', () => {
    it('should only track files with included extensions', () => {
      watcher = new FileWatcher({ rootDir: '/project' });
      watcher.start();

      capturedListener!('change', 'src/app.ts');
      capturedListener!('change', 'src/style.css');
      capturedListener!('change', 'README.md');

      expect(watcher.getWatchedFiles()).toBe(1);
    });

    it('should respect custom includeExtensions', () => {
      watcher = new FileWatcher({ rootDir: '/project', includeExtensions: ['.py'] });
      watcher.start();

      capturedListener!('change', 'src/app.ts');
      capturedListener!('change', 'src/main.py');

      expect(watcher.getWatchedFiles()).toBe(1);
    });
  });

  describe('exclude directories', () => {
    it('should skip files in excluded directories', () => {
      watcher = new FileWatcher({ rootDir: '/project' });
      watcher.start();

      capturedListener!('change', 'node_modules/pkg/index.ts');
      capturedListener!('change', '.git/config');
      capturedListener!('change', 'dist/bundle.js');
      capturedListener!('change', 'src/app.ts');

      expect(watcher.getWatchedFiles()).toBe(1);
    });

    it('should respect custom excludeDirs', () => {
      watcher = new FileWatcher({ rootDir: '/project', excludeDirs: ['custom_skip'] });
      watcher.start();

      capturedListener!('change', 'custom_skip/file.ts');
      capturedListener!('change', 'src/app.ts');

      expect(watcher.getWatchedFiles()).toBe(1);
    });
  });

  describe('debounce behavior', () => {
    it('should debounce multiple rapid changes into a single flush', () => {
      const onIndexUpdated = vi.fn();
      watcher = new FileWatcher({ rootDir: '/project', debounceMs: 300, onIndexUpdated });
      watcher.start();

      capturedListener!('change', 'src/a.ts');
      vi.advanceTimersByTime(100);

      capturedListener!('change', 'src/b.ts');
      vi.advanceTimersByTime(100);

      capturedListener!('change', 'src/c.ts');

      expect(onIndexUpdated).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);

      expect(onIndexUpdated).toHaveBeenCalledTimes(1);
      expect(onIndexUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ filesChecked: 3 }),
      );
    });

    it('should track unique changed files', () => {
      const onIndexUpdated = vi.fn();
      watcher = new FileWatcher({ rootDir: '/project', debounceMs: 200, onIndexUpdated });
      watcher.start();

      capturedListener!('change', 'src/a.ts');
      capturedListener!('change', 'src/a.ts');
      capturedListener!('change', 'src/a.ts');

      vi.advanceTimersByTime(200);

      expect(onIndexUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ filesChecked: 1 }),
      );
    });
  });

  describe('stop', () => {
    it('should close the watcher and clear timer', () => {
      watcher = new FileWatcher({ rootDir: '/project' });
      watcher.start();

      capturedListener!('change', 'src/app.ts');

      watcher.stop();

      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(watcher.getWatchedFiles()).toBe(0);
    });

    it('should be safe to call stop when not started', () => {
      watcher = new FileWatcher({ rootDir: '/project' });
      expect(() => watcher.stop()).not.toThrow();
    });
  });

  describe('flush callback', () => {
    it('should report duration in stats', () => {
      const onIndexUpdated = vi.fn();
      watcher = new FileWatcher({ rootDir: '/project', debounceMs: 100, onIndexUpdated });
      watcher.start();

      capturedListener!('change', 'src/app.ts');
      vi.advanceTimersByTime(100);

      expect(onIndexUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          filesChecked: 1,
          duration: expect.any(Number),
        }),
      );
    });

    it('should not call onIndexUpdated when no callback provided', () => {
      watcher = new FileWatcher({ rootDir: '/project', debounceMs: 100 });
      watcher.start();

      capturedListener!('change', 'src/app.ts');
      expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    });

    it('should clear changed files after flush', () => {
      watcher = new FileWatcher({ rootDir: '/project', debounceMs: 100 });
      watcher.start();

      capturedListener!('change', 'src/app.ts');
      expect(watcher.getWatchedFiles()).toBe(1);

      vi.advanceTimersByTime(100);
      expect(watcher.getWatchedFiles()).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should ignore events with no filename', () => {
      watcher = new FileWatcher({ rootDir: '/project' });
      watcher.start();

      capturedListener!('change', null as unknown as string);

      expect(watcher.getWatchedFiles()).toBe(0);
    });

    it('should handle multiple start-stop cycles', () => {
      watcher = new FileWatcher({ rootDir: '/project' });

      watcher.start();
      watcher.stop();
      capturedListener = undefined;

      watcher.start();

      expect(mockedWatch).toHaveBeenCalledTimes(2);
    });
  });
});
