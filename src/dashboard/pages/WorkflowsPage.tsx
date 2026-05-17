import { useState, useEffect, useCallback } from 'react';
import { createApiClient, type ApiError } from '../lib/api.js';
import type { WorkflowSummary, WorkflowRunResult } from '../types.js';

const api = createApiClient();

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [variables, setVariables] = useState('{}');
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        setLoading(true);
        const result = await api.listWorkflows(controller.signal);
        setWorkflows(result.workflows);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as ApiError).error || 'Failed to load workflows');
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const runWorkflow = useCallback(async () => {
    if (!selectedName) return;
    let vars: Record<string, string>;
    try {
      vars = JSON.parse(variables);
    } catch {
      setError('Invalid JSON in variables');
      return;
    }

    try {
      setRunning(true);
      setError(null);
      setRunResult(null);
      const result = await api.runWorkflow(selectedName, vars);
      setRunResult(result);
    } catch (err) {
      setError((err as ApiError).error || 'Workflow run failed');
    } finally {
      setRunning(false);
    }
  }, [selectedName, variables]);

  const selected = workflows.find((w) => w.name === selectedName);

  return (
    <div className="workflows-page">
      <div className="page-header">
        <h1>Workflows</h1>
      </div>

      {error && (
        <div className="page-error">
          <span>{error}</span>
          <button className="btn btn-connect" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="workflows-layout">
        <div className="workflows-list">
          {loading && workflows.length === 0 ? (
            <div className="page-loading">Loading workflows...</div>
          ) : workflows.length === 0 ? (
            <div className="page-empty">No workflows found</div>
          ) : (
            <ul className="workflow-items">
              {workflows.map((wf) => (
                <li
                  key={wf.name}
                  className={`workflow-item ${selectedName === wf.name ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedName(wf.name);
                    setRunResult(null);
                  }}
                >
                  <strong>{wf.name}</strong>
                  <span className="workflow-version">v{wf.version}</span>
                  <span className="workflow-steps">{wf.stepCount} steps</span>
                  {wf.tags && wf.tags.length > 0 && (
                    <div className="workflow-tags">
                      {wf.tags.map((tag) => (
                        <span key={tag} className="workflow-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="workflow-detail">
          {selected ? (
            <>
              <div className="workflow-detail-header">
                <h2>{selected.name}</h2>
                <span className="workflow-version">v{selected.version}</span>
              </div>
              {selected.description && <p className="workflow-desc">{selected.description}</p>}
              <p className="workflow-step-count">{selected.stepCount} steps</p>

              <div className="workflow-run-form">
                <h3>Run Workflow</h3>
                <label className="workflow-var-label">
                  Variables (JSON):
                  <textarea
                    className="workflow-var-input"
                    value={variables}
                    onChange={(e) => setVariables(e.target.value)}
                    rows={4}
                    placeholder='{"key": "value"}'
                  />
                </label>
                <button
                  className="btn btn-connect"
                  onClick={runWorkflow}
                  disabled={running}
                >
                  {running ? 'Running...' : 'Run'}
                </button>
              </div>

              {runResult && (
                <div className="workflow-run-result">
                  <h3>Run Result</h3>
                  <div className="run-result-meta">
                    <span>Status: <strong>{runResult.status}</strong></span>
                    <span>Run ID: {runResult.runId}</span>
                    {runResult.completedAt && (
                      <span>Duration: {runResult.completedAt - runResult.startedAt}ms</span>
                    )}
                  </div>
                  {Object.keys(runResult.stepResults).length > 0 && (
                    <table className="run-result-table">
                      <thead>
                        <tr><th>Step</th><th>Result</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(runResult.stepResults).map(([step, result]) => (
                          <tr key={step}>
                            <td>{step}</td>
                            <td><pre>{JSON.stringify(result, null, 2)}</pre></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="page-empty">Select a workflow to view details and run</div>
          )}
        </div>
      </div>
    </div>
  );
}
