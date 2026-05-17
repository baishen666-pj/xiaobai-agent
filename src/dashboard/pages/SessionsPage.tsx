import { useState, useEffect, useCallback } from 'react';
import { useDashboardContext } from '../hooks/useDashboardContext.js';
import { createApiClient, type ApiError } from '../lib/api.js';

const api = createApiClient();

export function SessionsPage() {
  const { send } = useDashboardContext();

  const [sessions, setSessions] = useState<Array<{ id: string; createdAt: number; updatedAt: number; messageCount: number }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadSessions = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.listSessions(signal);
      setSessions(result.sessions);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as ApiError).error || 'Failed to load sessions');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadSessions(controller.signal);
    return () => controller.abort();
  }, [loadSessions]);

  const selectSession = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      const result = await api.getSession(id);
      setSelectedDetail(result.session as Record<string, unknown>);
    } catch {
      setSelectedDetail(null);
    }
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    if (!window.confirm(`Delete session ${id}?`)) return;
    try {
      setDeleting(id);
      await api.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setSelectedDetail(null);
      }
    } catch (err) {
      setError((err as ApiError).error || 'Failed to delete session');
    } finally {
      setDeleting(null);
    }
  }, [selectedId]);

  const createSession = useCallback(() => {
    send({ type: 'session_create' });
  }, [send]);

  const resumeSession = useCallback((id: string) => {
    send({ type: 'session_resume', sessionId: id });
  }, [send]);

  return (
    <div className="sessions-page">
      <div className="page-header">
        <h1>Sessions</h1>
        <button className="btn btn-connect" onClick={createSession}>New Session</button>
      </div>

      {error && (
        <div className="page-error">
          <span>{error}</span>
          <button className="btn btn-connect" onClick={() => loadSessions()}>Retry</button>
        </div>
      )}

      <div className="sessions-layout">
        <div className="sessions-list">
          {loading && sessions.length === 0 ? (
            <div className="page-loading">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="page-empty">No sessions found</div>
          ) : (
            <ul className="session-items">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className={`session-item ${selectedId === session.id ? 'selected' : ''}`}
                >
                  <button className="session-item-btn" onClick={() => selectSession(session.id)}>
                    <span className="session-id">{session.id.slice(0, 8)}</span>
                    <span className="session-meta">{session.messageCount} msgs</span>
                    <span className="session-time">{new Date(session.updatedAt).toLocaleTimeString()}</span>
                  </button>
                  <div className="session-item-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => resumeSession(session.id)}
                      title="Resume session"
                    >
                      Resume
                    </button>
                    <button
                      className="btn btn-sm btn-disconnect"
                      onClick={() => deleteSession(session.id)}
                      disabled={deleting === session.id}
                      title="Delete session"
                    >
                      {deleting === session.id ? '...' : 'Delete'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="session-detail">
          {selectedDetail ? (
            <pre className="session-json">{JSON.stringify(selectedDetail, null, 2)}</pre>
          ) : (
            <div className="page-empty">Select a session to view details</div>
          )}
        </div>
      </div>
    </div>
  );
}
