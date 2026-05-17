import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DashboardProvider } from './hooks/useDashboardContext.js';
import { Sidebar } from './components/Sidebar.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { AgentsPage } from './pages/AgentsPage.js';
import { SessionsPage } from './pages/SessionsPage.js';
import { WorkflowsPage } from './pages/WorkflowsPage.js';
import { PlaygroundPage } from './pages/PlaygroundPage.js';
import { HealthPage } from './pages/HealthPage.js';
import './App.css';

export function App() {
  return (
    <BrowserRouter>
      <DashboardProvider>
        <div className="dashboard-layout">
          <Sidebar />
          <main className="dashboard-content">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/sessions" element={<SessionsPage />} />
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/health" element={<HealthPage />} />
            </Routes>
          </main>
        </div>
      </DashboardProvider>
    </BrowserRouter>
  );
}
