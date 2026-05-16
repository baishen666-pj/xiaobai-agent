import { describe, it, expect, beforeEach } from 'vitest';
import { RuntimeMetrics, type MetricSummary, type MetricsSnapshot } from '../../src/core/metrics.js';

describe('RuntimeMetrics', () => {
  let metrics: RuntimeMetrics;

  beforeEach(() => {
    metrics = new RuntimeMetrics(100);
  });

  describe('counters', () => {
    it('should increment counters', () => {
      metrics.incrementCounter('requests');
      metrics.incrementCounter('requests');
      metrics.incrementCounter('errors');

      expect(metrics.getCounter('requests')).toBe(2);
      expect(metrics.getCounter('errors')).toBe(1);
    });

    it('should increment by custom value', () => {
      metrics.incrementCounter('bytes', 1024);
      metrics.incrementCounter('bytes', 2048);

      expect(metrics.getCounter('bytes')).toBe(3072);
    });

    it('should return 0 for unknown counters', () => {
      expect(metrics.getCounter('unknown')).toBe(0);
    });

    it('should support tagged counters', () => {
      metrics.incrementCounter('requests', 1, { method: 'GET' });
      metrics.incrementCounter('requests', 1, { method: 'POST' });
      metrics.incrementCounter('requests', 2, { method: 'GET' });

      expect(metrics.getCounter('requests', { method: 'GET' })).toBe(3);
      expect(metrics.getCounter('requests', { method: 'POST' })).toBe(1);
    });
  });

  describe('gauges', () => {
    it('should set gauge values', () => {
      metrics.setGauge('memory_mb', 512);
      expect(metrics.getGauge('memory_mb')).toBe(512);

      metrics.setGauge('memory_mb', 1024);
      expect(metrics.getGauge('memory_mb')).toBe(1024);
    });

    it('should return 0 for unknown gauges', () => {
      expect(metrics.getGauge('unknown')).toBe(0);
    });

    it('should support tagged gauges', () => {
      metrics.setGauge('connections', 10, { pool: 'primary' });
      metrics.setGauge('connections', 5, { pool: 'replica' });

      expect(metrics.getGauge('connections', { pool: 'primary' })).toBe(10);
      expect(metrics.getGauge('connections', { pool: 'replica' })).toBe(5);
    });
  });

  describe('histograms', () => {
    it('should record histogram values', () => {
      metrics.recordHistogram('latency', 100);
      metrics.recordHistogram('latency', 200);
      metrics.recordHistogram('latency', 300);

      const summary = metrics.getHistogramSummary('latency');
      expect(summary).not.toBeNull();
      expect(summary!.count).toBe(3);
      expect(summary!.min).toBe(100);
      expect(summary!.max).toBe(300);
      expect(summary!.mean).toBeCloseTo(200, 1);
    });

    it('should return null for unknown histograms', () => {
      expect(metrics.getHistogramSummary('unknown')).toBeNull();
    });

    it('should calculate percentiles', () => {
      for (let i = 1; i <= 100; i++) {
        metrics.recordHistogram('latency', i);
      }

      const summary = metrics.getHistogramSummary('latency')!;
      expect(summary.p50).toBeGreaterThanOrEqual(50);
      expect(summary.p50).toBeLessThanOrEqual(51);
      expect(summary.p95).toBeGreaterThanOrEqual(95);
      expect(summary.p99).toBeGreaterThanOrEqual(99);
    });

    it('should support tagged histograms', () => {
      metrics.recordHistogram('latency', 50, { provider: 'anthropic' });
      metrics.recordHistogram('latency', 200, { provider: 'openai' });

      const anthropic = metrics.getHistogramSummary('latency', { provider: 'anthropic' });
      expect(anthropic?.mean).toBe(50);

      const openai = metrics.getHistogramSummary('latency', { provider: 'openai' });
      expect(openai?.mean).toBe(200);
    });

    it('should trim histogram values to max samples', () => {
      const smallMetrics = new RuntimeMetrics(10);
      for (let i = 0; i < 20; i++) {
        smallMetrics.recordHistogram('latency', i);
      }

      const summary = smallMetrics.getHistogramSummary('latency')!;
      expect(summary.count).toBe(10);
      expect(summary.min).toBe(10);
    });
  });

  describe('custom metrics', () => {
    it('should store and retrieve custom metrics', () => {
      metrics.setCustom('config', { model: 'gpt-4o', temperature: 0.7 });
      expect(metrics.getCustom('config')).toEqual({ model: 'gpt-4o', temperature: 0.7 });
    });

    it('should return undefined for unknown custom metrics', () => {
      expect(metrics.getCustom('unknown')).toBeUndefined();
    });
  });

  describe('snapshots', () => {
    it('should produce a complete snapshot', () => {
      metrics.incrementCounter('requests');
      metrics.setGauge('memory', 512);
      metrics.recordHistogram('latency', 100);
      metrics.setCustom('version', '0.4.0');

      const snap = metrics.snapshot();
      expect(snap.uptime).toBeGreaterThanOrEqual(0);
      expect(snap.counters['requests']).toBe(1);
      expect(snap.gauges['memory']).toBe(512);
      expect(snap.histograms['latency']).toBeDefined();
      expect(snap.custom['version']).toBe('0.4.0');
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      metrics.incrementCounter('requests');
      metrics.setGauge('memory', 512);
      metrics.recordHistogram('latency', 100);

      metrics.reset();

      expect(metrics.getCounter('requests')).toBe(0);
      expect(metrics.getGauge('memory')).toBe(0);
      expect(metrics.getHistogramSummary('latency')).toBeNull();
    });
  });

  describe('formatReport', () => {
    it('should format a readable report', () => {
      metrics.incrementCounter('tool_calls', 5);
      metrics.setGauge('active_sessions', 3);
      metrics.recordHistogram('request_latency', 150);
      metrics.recordHistogram('request_latency', 300);

      const report = metrics.formatReport();
      expect(report).toContain('Runtime Metrics Report');
      expect(report).toContain('tool_calls: 5');
      expect(report).toContain('active_sessions: 3');
      expect(report).toContain('request_latency');
    });

    it('should handle empty metrics', () => {
      const report = metrics.formatReport();
      expect(report).toContain('Runtime Metrics Report');
    });
  });
});