import { useState, useEffect, useCallback } from 'react';
import { useDashboardContext } from '../hooks/useDashboardContext.js';

interface RemoteAgent {
  name: string;
  protocol: 'a2a' | 'acp';
  url: string;
  role?: string;
}

export function RemoteAgentsPage() {
  const { wsUrl } = useDashboardContext();
  const [agents, setAgents] = useState<RemoteAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registerForm, setRegisterForm] = useState({ name: '', protocol: 'a2a' as const, url: '', role: '' });

  const httpUrl = wsUrl.replace('ws://', 'http://');

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${httpUrl}/api/agents`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAgents(data.agents ?? data ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [httpUrl]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${httpUrl}/api/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerForm),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRegisterForm({ name: '', protocol: 'a2a', url: '', role: '' });
      await fetchAgents();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleUnregister = async (name: string) => {
    try {
      const res = await fetch(`${httpUrl}/api/agents/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchAgents();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="remote-agents-page">
      <div className="page-header">
        <h1>Remote Agents</h1>
        <span className="page-subtitle">{agents.length} agent{agents.length !== 1 ? 's' : ''} registered</span>
      </div>

      {error && <div className="panel error-banner">{error}</div>}

      <section className="panel">
        <h2>Register Agent</h2>
        <form onSubmit={handleRegister} className="register-form">
          <input
            placeholder="Name"
            value={registerForm.name}
            onChange={(e) => setRegisterForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <select
            value={registerForm.protocol}
            onChange={(e) => setRegisterForm((f) => ({ ...f, protocol: e.target.value as 'a2a' | 'acp' }))}
          >
            <option value="a2a">A2A</option>
            <option value="acp">ACP</option>
          </select>
          <input
            placeholder="URL"
            value={registerForm.url}
            onChange={(e) => setRegisterForm((f) => ({ ...f, url: e.target.value }))}
            required
          />
          <input
            placeholder="Role (optional)"
            value={registerForm.role}
            onChange={(e) => setRegisterForm((f) => ({ ...f, role: e.target.value }))}
          />
          <button type="submit">Register</button>
        </form>
      </section>

      <section className="panel">
        <h2>Registered Agents</h2>
        {loading ? (
          <p className="loading-text">Loading...</p>
        ) : agents.length === 0 ? (
          <p className="empty-text">No remote agents registered.</p>
        ) : (
          <table className="agents-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Protocol</th>
                <th>URL</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.name}>
                  <td>{agent.name}</td>
                  <td><span className={`protocol-badge ${agent.protocol}`}>{agent.protocol.toUpperCase()}</span></td>
                  <td className="url-cell">{agent.url}</td>
                  <td>{agent.role ?? '-'}</td>
                  <td>
                    <button className="btn-danger" onClick={() => handleUnregister(agent.name)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
