import { useState, useEffect, useCallback } from 'react';
import { createApiClient, type ApiError } from '../lib/api.js';
import type { HealthResult, LivenessResult, ReadinessResult } from '../types.js';

const api = createApiClient();
const REFRESH_INTERVAL = 10_000;

export function HealthPage() {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [liveness, setLiveness] = useState<LivenessResult | null>(null);
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const fetchAll = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const [h, l, r] = await Promise.all([
        api.health(signal),
        api.liveness(signal),
        api.readiness(signal),
      ]);
      setHealth(h);
      setLiveness(l);
      setReadiness(r);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as ApiError).error || 'Health check failed');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchAll(controller.signal);
    const interval = setInterval(() => fetchAll(controller.signal), REFRESH_INTERVAL);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchAll]);

  const statusColor = (status?: string) => {
    if (!status) return 'unknown';
    if (status === 'healthy') return 'healthy';
    if (status === 'degraded') return 'degraded';
    return 'unhealthy';
  };

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="health-page">
      <div className="page-header">
        <h1>System Health</h1>
        <button className="btn btn-sm" onClick={() => fetchAll()} disabled={loading}>
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="page-error">
          <span>{error}</span>
          <button className="btn btn-connect" onClick={() => fetchAll()}>Retry</button>
        </div>
      )}

      {health && (
        <div className="health-status-banner" data-status={statusColor(health.status)}>
          <div className="health-status-main">
            <span className={`health-status-badge ${statusColor(health.status)}`}>
              {health.status.toUpperCase()}
            </span>
            <span className="health-version">v{health.version}</span>
            <span className="health-uptime">Uptime: {formatUptime(health.uptime)}</span>
          </div>
          <div className="health-checks-grid">
            {Object.entries(health.checks).map(([key, check]) => (
              <div key={key} className={`health-subsystem-card ${statusColor(check.status)}`}>
                <h3>{key}</h3>
                <span className={`health-status-badge ${statusColor(check.status)}`}>
                  {check.status}
                </span>
                <span className="health-latency">{check.latencyMs}ms</span>
                {check.detail && <p className="health-detail">{check.detail}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="health-probes-grid">
        {liveness && (
          <div className="panel health-probe-card">
            <h2>Liveness</h2>
            <span className={`health-status-badge ${liveness.alive ? 'healthy' : 'unhealthy'}`}>
              {liveness.alive ? 'ALIVE' : 'DEAD'}
            </span>
            <span className="health-uptime">Uptime: {formatUptime(liveness.uptime)}</span>
          </div>
        )}
        {readiness && (
          <div className="panel health-probe-card">
            <h2>Readiness</h2>
            <span className={`health-status-badge ${readiness.ready ? 'healthy' : 'unhealthy'}`}>
              {readiness.ready ? 'READY' : 'NOT READY'}
            </span>
          </div>
        )}
      </div>

      <div className="health-raw-toggle">
        <button className="btn btn-sm" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? 'Hide' : 'Show'} Raw JSON
        </button>
      </div>

      {showRaw && health && (
        <pre className="health-raw-json">{JSON.stringify({ health, liveness, readiness }, null, 2)}</pre>
      )}
    </div>
  );
}
