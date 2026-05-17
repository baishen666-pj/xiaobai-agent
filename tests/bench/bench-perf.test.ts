import { describe, it, expect } from 'vitest';
import { RuntimeMetrics } from '../../src/core/metrics.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { MemorySystem } from '../../src/memory/system.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ITERATIONS = 1000;

describe('Performance Benchmarks', () => {
  describe('RuntimeMetrics', () => {
    it(`handles ${ITERATIONS} histogram recordings efficiently`, () => {
      const metrics = new RuntimeMetrics();
      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        metrics.recordHistogram('latency', Math.random() * 100, { provider: 'test' });
      }

      const elapsed = performance.now() - start;
      const perOp = elapsed / ITERATIONS;

      console.log(`  histogram ${ITERATIONS}x: ${elapsed.toFixed(1)}ms (${perOp.toFixed(3)}ms/op)`);
      expect(elapsed).toBeLessThan(500);
      expect(perOp).toBeLessThan(1);
    });

    it(`handles ${ITERATIONS} counter increments efficiently`, () => {
      const metrics = new RuntimeMetrics();
      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        metrics.incrementCounter('requests', { provider: 'test' });
      }

      const elapsed = performance.now() - start;
      const perOp = elapsed / ITERATIONS;

      console.log(`  counter ${ITERATIONS}x: ${elapsed.toFixed(1)}ms (${perOp.toFixed(3)}ms/op)`);
      expect(elapsed).toBeLessThan(200);
    });

    it('snapshot performance with populated metrics', () => {
      const metrics = new RuntimeMetrics();
      for (let i = 0; i < 500; i++) {
        metrics.recordHistogram('latency', Math.random() * 100, { provider: `p${i % 5}` });
        metrics.incrementCounter('requests', { provider: `p${i % 5}` });
      }

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        metrics.snapshot();
      }
      const elapsed = performance.now() - start;

      console.log(`  snapshot 100x (500 metrics): ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('ToolRegistry', () => {
    it(`getToolDefinitions performance with many tools`, () => {
      const registry = new ToolRegistry();

      for (let i = 0; i < 30; i++) {
        registry.register({
          definition: {
            name: `tool_${i}`,
            description: `Test tool ${i}`,
            parameters: {
              type: 'object' as const,
              properties: { input: { type: 'string' } },
              required: ['input'],
            },
          },
          execute: async () => ({ output: 'ok', success: true }),
        });
      }

      for (let i = 0; i < 10; i++) {
        registry.registerMcpTool(`server${i}`, {
          definition: {
            name: `mcp_tool_${i}`,
            description: `MCP tool ${i}`,
            parameters: {
              type: 'object' as const,
              properties: { query: { type: 'string' } },
              required: [],
            },
          },
          execute: async () => ({ output: 'ok', success: true }),
        });
      }

      const start = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        registry.getToolDefinitions();
      }
      const elapsed = performance.now() - start;

      console.log(`  getToolDefinitions ${ITERATIONS}x (40 tools): ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(500);
    });

    it('tool execution throughput', async () => {
      const registry = new ToolRegistry();
      registry.register({
        definition: { name: 'echo', description: 'Echo', parameters: { type: 'object' as const, properties: {} } },
        execute: async () => ({ output: 'ok', success: true }),
      });

      const start = performance.now();
      const promises = Array.from({ length: 100 }, () => registry.execute('echo', {}));
      await Promise.all(promises);
      const elapsed = performance.now() - start;

      console.log(`  execute 100 concurrent: ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('MemorySystem', () => {
    let tempDir: string;
    let memory: MemorySystem;

    beforeEach(() => {
      tempDir = join(tmpdir(), `xiaobai-bench-mem-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      memory = new MemorySystem(tempDir);
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it(`handles ${ITERATIONS} sequential adds`, async () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        await memory.add('long-term', `benchmark entry ${i}`);
      }

      const elapsed = performance.now() - start;
      console.log(`  memory.add 100x: ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(5000);
    });

    it('getSystemPromptBlock performance', async () => {
      for (let i = 0; i < 50; i++) {
        await memory.add('long-term', `memory entry ${i} with some content`);
      }

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        memory.getSystemPromptBlock();
      }
      const elapsed = performance.now() - start;

      console.log(`  getSystemPromptBlock 100x (50 entries): ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('String Operations', () => {
    it('string concatenation vs array join for streaming', () => {
      const chunks = Array.from({ length: 500 }, (_, i) => `chunk ${i} with some text content here. `);

      const startConcat = performance.now();
      let str = '';
      for (const chunk of chunks) {
        str += chunk;
      }
      const concatTime = performance.now() - startConcat;

      const startJoin = performance.now();
      const parts: string[] = [];
      for (const chunk of chunks) {
        parts.push(chunk);
      }
      const joined = parts.join('');
      const joinTime = performance.now() - startJoin;

      console.log(`  concat 500 chunks: ${concatTime.toFixed(2)}ms, array+join: ${joinTime.toFixed(2)}ms`);
      expect(str).toBe(joined);
    });
  });
});
