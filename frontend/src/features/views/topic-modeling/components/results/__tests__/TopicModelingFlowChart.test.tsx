import { fireEvent, render, screen, within } from '@testing-library/react';
import type * as XYFlowReact from '@xyflow/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type TopicFlowNode,
  TopicLassoCanvas,
  TopicModelingFlowChart,
} from '../TopicModelingFlowChart';
import type { TopicBubbleModel } from '../topicModelingGraph';

vi.mock('@xyflow/react', async (importOriginal) => {
  const original = await importOriginal<typeof XYFlowReact>();
  return {
    ...original,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    ReactFlow: ({
      children,
      nodes,
      nodeTypes,
    }: {
      children: ReactNode;
      nodes: TopicFlowNode[];
      nodeTypes?: XYFlowReact.NodeTypes;
    }) => {
      const node = nodes[0];
      const NodeComponent = node ? nodeTypes?.[node.type ?? 'default'] : undefined;
      const nodeProps = node
        ? ({
            id: node.id,
            data: node.data,
            type: node.type,
            positionAbsoluteX: node.position.x,
            positionAbsoluteY: node.position.y,
            selected: false,
            selectable: false,
            draggable: false,
            deletable: true,
            isConnectable: false,
            dragging: false,
            zIndex: node.zIndex ?? 0,
          } as XYFlowReact.NodeProps<TopicFlowNode>)
        : null;
      return (
        <div>
          {NodeComponent && nodeProps ? <NodeComponent {...nodeProps} /> : null}
          {children}
        </div>
      );
    },
    NodeToolbar: ({
      children,
      isVisible,
      className,
      align,
      position,
      offset,
      ...props
    }: XYFlowReact.NodeToolbarProps) =>
      isVisible ? (
        <div
          {...props}
          className={className}
          data-align={align}
          data-position={position}
          data-offset={offset}
        >
          {children}
        </div>
      ) : null,
    Controls: ({
      children,
      orientation,
      position,
      className,
      showZoom: _showZoom,
      showFitView: _showFitView,
      showInteractive: _showInteractive,
      ...props
    }: XYFlowReact.ControlProps) => (
      <div {...props} className={className} data-orientation={orientation} data-position={position}>
        {children}
      </div>
    ),
    ControlButton: ({ children, ...props }: XYFlowReact.ControlButtonProps) => (
      <button {...props}>{children}</button>
    ),
    useReactFlow: () => ({
      fitView: () => Promise.resolve(true),
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    }),
  };
});

vi.mock('@/features/views/common/components/ResponsiveWordCloud', () => ({
  ResponsiveWordCloud: ({ words }: { words: { text: string; value: number }[] }) => (
    <div>{words.map((word) => `${word.text}:${String(word.value)}`).join(', ')}</div>
  ),
}));

const bubble: TopicBubbleModel = {
  id: 7,
  topic: {
    id: 7,
    representative_words: [{ word: 'topic', occurrence_count: 1 }],
    size: [1],
    total_size: 1,
    x: 0,
    y: 0,
  },
  position: { x: 50, y: 50 },
  radius: 20,
  fill: '#2563eb',
  selected: false,
  lassoed: false,
  hovered: false,
  filteredOut: false,
};

describe('TopicLassoCanvas', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  it('commits a normal release outside the canvas using the latest freehand path', () => {
    const onComplete = vi.fn();
    render(<TopicLassoCanvas enabled bubbles={[bubble]} onComplete={onComplete} />);
    const canvas = screen.getByLabelText('Draw an additive lasso around topic bubbles');

    fireEvent.pointerDown(canvas, { pointerId: 4, button: 0, clientX: 35, clientY: 35 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 65, clientY: 35 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 65, clientY: 65 });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 35, clientY: 65 });

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(new Set([7]));
  });

  it('discards cancelled gestures without changing the filter', () => {
    const onComplete = vi.fn();
    render(<TopicLassoCanvas enabled bubbles={[bubble]} onComplete={onComplete} />);
    const canvas = screen.getByLabelText('Draw an additive lasso around topic bubbles');

    fireEvent.pointerDown(canvas, { pointerId: 9, button: 0, clientX: 35, clientY: 35 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 65, clientY: 35 });
    fireEvent.pointerCancel(window, { pointerId: 9 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 65, clientY: 65 });

    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('TopicModelingFlowChart', () => {
  it('visually mutes toolbar actions while they are disabled', () => {
    render(
      <TopicModelingFlowChart
        bubbles={[bubble]}
        corpusPresentation={{
          corpusCount: 1,
          panelNodeIds: ['corpus-1'],
          nodeColors: { 'corpus-1': '#2563eb' },
          defaultPalette: ['#2563eb'],
        }}
        projectionKey="analysis-1:7"
        lassoMode={false}
        lassoFilterActive={false}
        exportDisabled
        onToggleLassoMode={vi.fn()}
        onClearLassoFilter={vi.fn()}
        onAddLassoTopics={vi.fn()}
        onDownload={vi.fn()}
        onViewReady={vi.fn()}
        onToggleTopicSelection={vi.fn()}
      />,
    );

    for (const name of ['Clear lasso filter', 'Download chart']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveClass(
        'disabled:!bg-editor',
        'disabled:!text-[var(--vscode-icon-foreground)]',
        'disabled:!opacity-40',
      );
    }
  });

  it('places an expandable vertical control rail in the upper-left corner', () => {
    const onClearLassoFilter = vi.fn();
    render(
      <TopicModelingFlowChart
        bubbles={[bubble]}
        corpusPresentation={{
          corpusCount: 1,
          panelNodeIds: ['corpus-1'],
          nodeColors: { 'corpus-1': '#2563eb' },
          defaultPalette: ['#2563eb'],
        }}
        projectionKey="analysis-1:7"
        lassoMode={false}
        lassoFilterActive
        exportDisabled={false}
        onToggleLassoMode={vi.fn()}
        onClearLassoFilter={onClearLassoFilter}
        onAddLassoTopics={vi.fn()}
        onDownload={vi.fn()}
        onViewReady={vi.fn()}
        onToggleTopicSelection={vi.fn()}
      />,
    );

    const controls = screen.getByLabelText('Topic graph controls');
    expect(controls).toHaveAttribute('data-orientation', 'vertical');
    expect(controls).toHaveAttribute('data-position', 'top-left');
    expect(controls).toHaveClass('group/topic-controls');
    const buttons = within(controls).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Zoom in',
      'Zoom out',
      'Fit view',
      'Enable additive lasso',
      'Clear lasso filter',
      'Download chart',
    ]);
    for (const button of buttons) {
      expect(button).not.toHaveAttribute('title');
    }
    expect(within(controls).getByText('Select topics')).toHaveClass(
      'group-hover/topic-controls:opacity-100',
    );
    fireEvent.click(within(controls).getByRole('button', { name: 'Clear lasso filter' }));
    expect(onClearLassoFilter).toHaveBeenCalledOnce();
  });

  it('keeps one node-anchored tooltip visible through pointer movement and data refreshes', () => {
    const view = render(
      <TopicModelingFlowChart
        bubbles={[bubble]}
        corpusPresentation={{
          corpusCount: 1,
          panelNodeIds: ['corpus-1'],
          nodeColors: { 'corpus-1': '#2563eb' },
          defaultPalette: ['#2563eb'],
        }}
        projectionKey="analysis-1:7"
        lassoMode={false}
        lassoFilterActive={false}
        exportDisabled={false}
        onToggleLassoMode={vi.fn()}
        onClearLassoFilter={vi.fn()}
        onAddLassoTopics={vi.fn()}
        onDownload={vi.fn()}
        onViewReady={vi.fn()}
        onToggleTopicSelection={vi.fn()}
      />,
    );

    const node = screen.getByTestId('topic-flow-node-7');
    expect(screen.queryByTestId('topic-flow-tooltip-7')).not.toBeInTheDocument();

    fireEvent.mouseEnter(node);
    const tooltip = screen.getByTestId('topic-flow-tooltip-7');
    expect(tooltip).toHaveAttribute('role', 'tooltip');
    expect(tooltip).toHaveAttribute('data-align', 'start');
    expect(tooltip).toHaveAttribute('data-position', 'right');
    expect(tooltip).toHaveClass('pointer-events-none');

    fireEvent.mouseMove(node, { clientX: 110, clientY: 90 });
    fireEvent.mouseMove(node, { clientX: 120, clientY: 100 });
    expect(screen.getByTestId('topic-flow-tooltip-7')).toBe(tooltip);

    view.rerender(
      <TopicModelingFlowChart
        bubbles={[
          {
            ...bubble,
            topic: {
              ...bubble.topic,
              representative_words: [{ word: 'updated', occurrence_count: 9 }],
              size: [14],
              total_size: 14,
            },
          },
        ]}
        corpusPresentation={{
          corpusCount: 1,
          panelNodeIds: ['corpus-1'],
          nodeColors: { 'corpus-1': '#2563eb' },
          defaultPalette: ['#2563eb'],
        }}
        projectionKey="analysis-1:7"
        lassoMode={false}
        lassoFilterActive={false}
        exportDisabled={false}
        onToggleLassoMode={vi.fn()}
        onClearLassoFilter={vi.fn()}
        onAddLassoTopics={vi.fn()}
        onDownload={vi.fn()}
        onViewReady={vi.fn()}
        onToggleTopicSelection={vi.fn()}
      />,
    );

    expect(screen.getByTestId('topic-flow-tooltip-7')).toBe(tooltip);
    expect(screen.getByText(/updated, 9 occurrences/)).toBeInTheDocument();
    expect(screen.getByText('= 14')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('topic-flow-node-7'));
    expect(screen.queryByTestId('topic-flow-tooltip-7')).not.toBeInTheDocument();
  });

  it('keeps filtered bubbles non-interactive and puts lasso above node tooltips', () => {
    render(
      <TopicModelingFlowChart
        bubbles={[{ ...bubble, filteredOut: true }]}
        corpusPresentation={{
          corpusCount: 1,
          panelNodeIds: ['corpus-1'],
          nodeColors: { 'corpus-1': '#2563eb' },
          defaultPalette: ['#2563eb'],
        }}
        projectionKey="analysis-1:7"
        lassoMode
        lassoFilterActive={false}
        exportDisabled={false}
        onToggleLassoMode={vi.fn()}
        onClearLassoFilter={vi.fn()}
        onAddLassoTopics={vi.fn()}
        onDownload={vi.fn()}
        onViewReady={vi.fn()}
        onToggleTopicSelection={vi.fn()}
      />,
    );

    expect(screen.getByTestId('topic-flow-node-7')).toHaveClass('pointer-events-none');
    expect(screen.getByLabelText('Draw an additive lasso around topic bubbles')).toHaveClass(
      'z-10',
    );
  });
});
