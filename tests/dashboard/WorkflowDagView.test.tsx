// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WorkflowDagView } from '../../src/dashboard/components/WorkflowDagView.js';

describe('WorkflowDagView', () => {
  it('renders empty state when no steps', () => {
    const { container } = render(<WorkflowDagView steps={[]} />);
    expect(container.textContent).toContain('No steps to display');
  });

  it('renders nodes for each step', () => {
    const steps = [
      { id: 'step-1', type: 'tools' as const, status: 'completed' as const },
      { id: 'step-2', type: 'agent' as const, status: 'running' as const },
      { id: 'step-3', type: 'subAgent' as const, status: 'pending' as const },
    ];
    const { container } = render(<WorkflowDagView steps={steps} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();

    // Should have 3 step groups (nodes)
    const groups = svg!.querySelectorAll('g');
    expect(groups.length).toBeGreaterThanOrEqual(3);
  });

  it('renders type labels on nodes', () => {
    const steps = [
      { id: 's1', type: 'tools' as const, status: 'completed' as const },
      { id: 's2', type: 'structured' as const, status: 'completed' as const },
    ];
    const { container } = render(<WorkflowDagView steps={steps} />);
    expect(container.textContent).toContain('Tools');
    expect(container.textContent).toContain('Structured');
  });

  it('renders connectors between steps', () => {
    const steps = [
      { id: 's1', type: 'agent' as const, status: 'completed' as const },
      { id: 's2', type: 'agent' as const, status: 'completed' as const },
    ];
    const { container } = render(<WorkflowDagView steps={steps} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('renders single step without connectors', () => {
    const steps = [
      { id: 's1', type: 'agent' as const, status: 'completed' as const },
    ];
    const { container } = render(<WorkflowDagView steps={steps} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(0);
  });

  it('renders different status colors', () => {
    const steps = [
      { id: 's1', type: 'agent' as const, status: 'failed' as const },
    ];
    const { container } = render(<WorkflowDagView steps={steps} />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBe(1);
    // Failed status should use red-ish stroke
    const stroke = rects[0].getAttribute('stroke');
    expect(stroke).toBeTruthy();
  });
});
