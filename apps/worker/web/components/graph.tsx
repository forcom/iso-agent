import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphResult } from '../api';
export default function GraphCanvas({ result, selected, onSelect }: { result: GraphResult; selected: string | null; onSelect: (id: string) => void }) {
  const nodes: Node[] = result.entities.map((node,index) => ({ id: node.id, position: { x: (index % 3) * 290, y: Math.floor(index / 3) * 140 }, data: { label: node.label }, selected: selected === node.id, ariaLabel: `${node.type ?? '자료'}: ${node.label}` }));
  const edges: Edge[] = result.relations.map(edge => ({ id: edge.id, source: edge.subjectId, target: edge.objectId, label: edge.type, selected: selected === edge.id, ariaLabel: edge.type }));
  return <div className="graph-canvas" aria-label="읽기 전용 근거 그래프"><ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false} edgesFocusable nodesFocusable elementsSelectable onSelectionChange={({nodes,edges}) => {const id=nodes[0]?.id ?? edges[0]?.id;if(id && id!==selected) onSelect(id);}} onNodeClick={(_event,node) => onSelect(node.id)} onEdgeClick={(_event,edge) => onSelect(edge.id)} fitView minZoom={0.25} maxZoom={1.5}><Background/><Controls showInteractive={false}/></ReactFlow></div>;
}
