import React from 'react';
import {
  ReactFlow,
  Node, 
  Edge, 
  Controls, 
  MiniMap, 
  Background, 
  BackgroundVariant,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Simple test component to verify edges work
const EdgeTest: React.FC = () => {
  const testNodes: Node[] = [
    {
      id: 'node1',
      position: { x: 0, y: 0 },
      data: { label: 'Parent 1' },
      type: 'default'
    },
    {
      id: 'node2', 
      position: { x: 200, y: 0 },
      data: { label: 'Parent 2' },
      type: 'default'
    },
    {
      id: 'node3',
      position: { x: 100, y: 150 },
      data: { label: 'Joined' },
      type: 'default'
    }
  ];

  const testEdges: Edge[] = [
    {
      id: 'edge1',
      source: 'node1',
      target: 'node3',
      type: 'smoothstep',
      style: { stroke: '#888', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#888' }
    },
    {
      id: 'edge2',
      source: 'node2', 
      target: 'node3',
      type: 'smoothstep',
      style: { stroke: '#888', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#888' }
    }
  ];

  return (
    <div style={{ height: '400px', width: '100%' }}>
      <h3>React Flow Edge Test</h3>
      <ReactFlow
        nodes={testNodes}
        edges={testEdges}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Controls />
        <MiniMap />
        <Background variant={BackgroundVariant.Dots} />
      </ReactFlow>
    </div>
  );
};

export default EdgeTest;
