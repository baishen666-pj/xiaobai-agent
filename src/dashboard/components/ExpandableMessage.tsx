import { useState } from 'react';

interface Props {
  content: string;
  maxLength?: number;
  className?: string;
}

export function ExpandableMessage({ content, maxLength = 200, className = '' }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (content.length <= maxLength) {
    return <span className={className}>{content}</span>;
  }

  return (
    <span className={`expandable ${className}`}>
      {expanded ? content : content.slice(0, maxLength) + '…'}
      <button className="expand-btn" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        {expanded ? 'show less' : 'show more'}
      </button>
    </span>
  );
}
