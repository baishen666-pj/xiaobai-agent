import { useEffect, useRef } from 'react';
import type { LogEvent } from '../hooks/useWebSocket.js';

interface Props {
  events: LogEvent[];
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

  return (
    <div className="event-log" ref={scrollRef}>
      {events.map((event, i) => (
        <div key={i} className="event-line">
          <span className="event-time">{formatTime(event.timestamp)}</span>
          <span className={`event-type ${event.type}`}>{event.type}</span>
          <span>{event.message}</span>
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
