import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { DashboardServer } from '../src/server/index.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CLI agents command', () => {
  it('lists available agent roles', () => {
    const output = execSync('npx tsx src/cli/index.ts agents', {
      cwd: 'E:/CCCC/xiaobai',
      encoding: 'utf-8',
    });

    expect(output).toContain('coordinator');
    expect(output).toContain('researcher');
    expect(output).toContain('coder');
    expect(output).toContain('reviewer');
    expect(output).toContain('planner');
    expect(output).toContain('tester');
  });
});

describe('CLI help', () => {
  it('shows help with all commands', () => {
    const output = execSync('npx tsx src/cli/index.ts --help', {
      cwd: 'E:/CCCC/xiaobai',
      encoding: 'utf-8',
    });

    expect(output).toContain('chat');
    expect(output).toContain('exec');
    expect(output).toContain('dashboard');
    expect(output).toContain('run');
    expect(output).toContain('agents');
    expect(output).toContain('config');
    expect(output).toContain('memory');
  });
});

describe('DashboardServer static file serving', () => {
  let server: DashboardServer;
  let port: number;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-static-'));
    writeFileSync(join(tempDir, 'index.html'), '<h1>Test Dashboard</h1>');
    writeFileSync(join(tempDir, 'test.js'), 'console.log("hi")');

    server = new DashboardServer({ port: 0, staticDir: tempDir });
    await server.start();
    port = (server as any).httpServer.address().port;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('serves index.html at root', async () => {
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Test Dashboard');
  });

  it('serves static files with correct mime type', async () => {
    const res = await fetch(`http://localhost:${port}/test.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('falls back to index.html for SPA routes', async () => {
    const res = await fetch(`http://localhost:${port}/some/spa/route`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Test Dashboard');
  });

  it('returns 404 when no index.html exists', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'xiaobai-empty-'));
    const noIndexServer = new DashboardServer({ port: 0, staticDir: emptyDir });
    await noIndexServer.start();
    const noIndexPort = (noIndexServer as any).httpServer.address().port;

    const res = await fetch(`http://localhost:${noIndexPort}/unknown`);
    expect(res.status).toBe(404);

    await noIndexServer.stop();
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('reports correct HTTP URL', async () => {
    expect(server.getHttpUrl()).toBe(`http://localhost:${port}`);
    expect(server.getPort()).toBe(port);
  });
});
