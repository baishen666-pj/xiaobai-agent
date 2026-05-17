import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');

describe('Dashboard Vite build output', () => {
  it('produces index.html', () => {
    expect(existsSync(join(PUBLIC_DIR, 'index.html'))).toBe(true);
  });

  it('index.html references hashed assets', async () => {
    const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf-8');
    expect(html).toMatch(/src="\/assets\/index-[A-Za-z0-9_-]+\.js"/);
    expect(html).toMatch(/href="\/assets\/index-[A-Za-z0-9_-]+\.css"/);
    expect(html).toContain('id="root"');
  });

  it('produces assets directory with JS and CSS', () => {
    const assetsDir = join(PUBLIC_DIR, 'assets');
    expect(existsSync(assetsDir)).toBe(true);

    const files = readdirSync(assetsDir);
    const jsFiles = files.filter((f) => f.endsWith('.js'));
    const cssFiles = files.filter((f) => f.endsWith('.css'));

    expect(jsFiles.length).toBeGreaterThanOrEqual(1);
    expect(cssFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('JS bundle within budget', () => {
    const assetsDir = join(PUBLIC_DIR, 'assets');
    const files = readdirSync(assetsDir);
    const jsFiles = files.filter((f) => f.endsWith('.js'));

    const totalSize = jsFiles.reduce((sum, file) => sum + statSync(join(assetsDir, file)).size, 0);
    expect(totalSize).toBeLessThan(800 * 1024);
  });

  it('CSS bundle within 50kb budget', () => {
    const assetsDir = join(PUBLIC_DIR, 'assets');
    const files = readdirSync(assetsDir);
    const cssFiles = files.filter((f) => f.endsWith('.css'));

    for (const file of cssFiles) {
      const size = statSync(join(assetsDir, file)).size;
      expect(size).toBeLessThan(50 * 1024);
    }
  });
});
