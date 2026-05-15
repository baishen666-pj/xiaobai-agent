import type { TaskInfo } from '../hooks/useWebSocket.js';

const STATUS_COLORS: Record<string, string> = {
  pending: '#888',
  running: '#5b8def',
  completed: '#4caf7d',
  failed: '#d95555',
};

const NODE_W = 140;
const NODE_H = 36;
const H_GAP = 40;
const V_GAP = 12;

interface Props {
  tasks: TaskInfo[];
}

export function TaskDependencyGraph({ tasks }: Props) {
  const hasDeps = tasks.some((t) => (t.dependencies?.length ?? 0) > 0);
  if (!hasDeps || tasks.length === 0) {
    return <div className="empty-state">No dependencies</div>;
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const levels = computeLevels(tasks);

  const totalWidth = Math.max(...levels.map((l) => l.length)) * (NODE_W + H_GAP) + H_GAP;
  const totalHeight = levels.length * (NODE_H + V_GAP) + V_GAP;

  const nodes: { id: string; x: number; y: number; task: TaskInfo }[] = [];
  levels.forEach((level, row) => {
    const colWidth = totalWidth / level.length;
    level.forEach((id, col) => {
      nodes.push({
        id,
        x: colWidth * col + (colWidth - NODE_W) / 2,
        y: row * (NODE_H + V_GAP) + V_GAP,
        task: taskMap.get(id)!,
      });
    });
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const node of nodes) {
    for (const depId of node.task.dependencies ?? []) {
      const dep = nodeMap.get(depId);
      if (dep) {
        edges.push({
          x1: dep.x + NODE_W / 2,
          y1: dep.y + NODE_H,
          x2: node.x + NODE_W / 2,
          y2: node.y,
        });
      }
    }
  }

  return (
    <div className="dep-graph-container">
      <svg
        className="dep-graph-svg"
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="var(--text-secondary)" />
          </marker>
        </defs>
        {edges.map((e, i) => (
          <line
            key={`edge-${i}`}
            x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke="var(--text-secondary)"
            strokeWidth={1}
            markerEnd="url(#arrowhead)"
            opacity={0.4}
          />
        ))}
        {nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x} y={n.y}
              width={NODE_W} height={NODE_H}
              rx={6}
              fill="var(--bg-surface)"
              stroke={STATUS_COLORS[n.task.status] || '#888'}
              strokeWidth={2}
            />
            <text
              x={n.x + NODE_W / 2}
              y={n.y + NODE_H / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--text-primary)"
              fontSize={10}
              fontFamily="var(--font-mono)"
            >
              {n.task.description.slice(0, 16)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function computeLevels(tasks: TaskInfo[]): string[][] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const levels: string[][] = [];
  const assigned = new Set<string>();

  let remaining = tasks.map((t) => t.id);
  let maxIter = tasks.length + 1;

  while (remaining.length > 0 && maxIter-- > 0) {
    const level: string[] = [];
    const nextRemaining: string[] = [];

    for (const id of remaining) {
      const task = taskMap.get(id);
      const deps = task?.dependencies ?? [];
      if (deps.every((d) => assigned.has(d))) {
        level.push(id);
      } else {
        nextRemaining.push(id);
      }
    }

    if (level.length === 0) break;
    levels.push(level);
    level.forEach((id) => assigned.add(id));
    remaining = nextRemaining;
  }

  if (remaining.length > 0) {
    levels.push(remaining);
  }

  return levels;
}
