import type { CSSProperties } from 'react';

interface DagStep {
  id: string;
  type: 'tools' | 'subAgent' | 'structured' | 'agent';
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface WorkflowDagViewProps {
  steps: DagStep[];
}

const STATUS_COLORS: Record<DagStep['status'], string> = {
  pending: '#6b7280',
  running: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
};

const TYPE_LABELS: Record<DagStep['type'], string> = {
  tools: 'Tools',
  subAgent: 'Sub-Agent',
  structured: 'Structured',
  agent: 'Agent',
};

export function WorkflowDagView({ steps }: WorkflowDagViewProps) {
  if (steps.length === 0) {
    return <p className="empty-text">No steps to display.</p>;
  }

  const nodeWidth = 140;
  const nodeHeight = 56;
  const gapY = 80;
  const svgWidth = 300;
  const svgHeight = steps.length * (nodeHeight + gapY) - gapY + 20;

  const getX = () => (svgWidth - nodeWidth) / 2;
  const getY = (i: number) => 10 + i * (nodeHeight + gapY);

  return (
    <div className="workflow-dag-view" style={{ overflowX: 'auto' }}>
      <svg width={svgWidth} height={svgHeight} style={{ display: 'block', margin: '0 auto' }}>
        {steps.map((step, i) => {
          const x = getX();
          const y = getY(i);
          const color = STATUS_COLORS[step.status];

          const connector = i < steps.length - 1 ? (
            <line
              key={`line-${step.id}`}
              x1={x + nodeWidth / 2}
              y1={y + nodeHeight}
              x2={getX() + nodeWidth / 2}
              y2={getY(i + 1)}
              stroke="#4b5563"
              strokeWidth={2}
              markerEnd="url(#arrowhead)"
            />
          ) : null;

          return (
            <g key={step.id}>
              <rect
                x={x}
                y={y}
                width={nodeWidth}
                height={nodeHeight}
                rx={8}
                fill={color}
                opacity={0.15}
                stroke={color}
                strokeWidth={2}
              />
              <text
                x={x + nodeWidth / 2}
                y={y + 22}
                textAnchor="middle"
                fill="currentColor"
                fontSize={13}
                fontWeight={600}
              >
                {step.id}
              </text>
              <text
                x={x + nodeWidth / 2}
                y={y + 40}
                textAnchor="middle"
                fill={color}
                fontSize={11}
              >
                {TYPE_LABELS[step.type]}
              </text>
              {connector}
            </g>
          );
        })}

        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#4b5563" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}
