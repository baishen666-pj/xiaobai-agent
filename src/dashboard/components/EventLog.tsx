import { useEffect, useRef } from 'react';
import type { LogEvent } from '../hooks/useWebSocket.js';

interface Props {
  events: LogEvent[];
}

function getTimeGroup(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 300_000) return 'Last 5 minutes';
  if (diff < 900_000) return 'Last 15 minutes';
  return 'Earlier';
}

export function EventLog({ events }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  if (events.length === 0) {
    return <div className="empty-state">No events yet</div>;
  }

  const groups: { label: string; events: LogEvent[] }[] = [];
  let currentLabel = '';
  for (const event of events) {
    const label = getTimeGroup(event.timestamp);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, events: [] });
    }
    groups[groups.length - 1].events.push(event);
  }

  return (
    <div className="event-log" ref={scrollRef}>
      {groups.map((group) => (
        <div key={group.label} className="event-group">
          <div className="event-group-label">{group.label}</div>
          {group.events.map((event, i) => (
            <div key={`${event.timestamp}_${i}`} className="event-line">
              <span className="event-time">{formatTime(event.timestamp)}</span>
              <span className={`event-type ${event.type}`}>{event.type}</span>
              <span>{event.message}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
