interface Props {
  filter: string;
  onFilterChange: (filter: string) => void;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'task_', label: 'Orchestrator' },
  { key: 'chat_', label: 'Chat' },
  { key: 'error', label: 'Errors' },
];

export function EventFilterBar({ filter, onFilterChange }: Props) {
  return (
    <div className="filter-bar">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          className={`filter-btn ${filter === f.key ? 'active' : ''}`}
          onClick={() => onFilterChange(f.key)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
