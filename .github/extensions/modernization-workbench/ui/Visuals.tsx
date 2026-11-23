import { useMemo } from "react";
import { Background, Controls, ReactFlow, type Node, type Edge, MarkerType, Position } from "@xyflow/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { Component, Finding, Relationship } from "./model";
import { breakdown } from "./model";

export function Graph({ components, relationships, selected, onSelect, title }: {
  components: Component[]; relationships: Relationship[]; selected?: string; onSelect: (id: string) => void; title: string;
}) {
  const shown = components.slice(0, 120);
  const { nodes, edges } = useMemo(() => {
    const known = new Set(shown.map(component => component.id));
    const layout = new dagre.graphlib.Graph({ multigraph: true }).setGraph({ rankdir: "LR", nodesep: 30, ranksep: 90 });
    layout.setDefaultEdgeLabel(() => ({}));
    for (const component of shown) layout.setNode(component.id, { width: 215, height: 78 });
    for (const link of relationships) if (known.has(link.source) && known.has(link.target)) layout.setEdge(link.source, link.target, {}, link.id);
    dagre.layout(layout);
    const nodes: Node[] = shown.map(component => {
      const position = layout.node(component.id);
      return {
        id: component.id,
        data: { label: `${component.name}\n${component.kind}` },
        position: { x: position.x - 107.5, y: position.y - 39 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selected: component.id === selected,
        draggable: false,
        ariaLabel: `${component.name}, ${component.kind}. Open evidence.`,
        style: { width: 215, borderRadius: 12 },
      };
    });
    const edges: Edge[] = relationships.filter(link => known.has(link.source) && known.has(link.target)).map(link => ({
      id: link.id, source: link.source, target: link.target, label: link.label,
      markerEnd: { type: MarkerType.ArrowClosed }, animated: false,
    }));
    return { nodes, edges };
  }, [components, relationships, selected]);
  if (!components.length) return <div className="empty-inline">No component evidence is available in this assessment.</div>;
  return <section aria-label={title}>
    <div className="graph">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesConnectable={false} elementsSelectable
        onNodeClick={(_, node) => onSelect(node.id)} proOptions={{ hideAttribution: true }}>
        <Background gap={24} /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    {components.length > shown.length && <p className="hint">Showing {shown.length} of {components.length} components. Every component remains available in the searchable table below.</p>}
    {!relationships.length && <p className="hint">Components are reported; no supported relationship evidence is available. Edges have not been invented.</p>}
  </section>;
}

export function Distribution({ findings, field, label, select }: {
  findings: Finding[]; field: "category" | "severity" | "priority"; label: string; select: (value: string) => void;
}) {
  const values = breakdown(findings, field);
  const chartValues = values.slice(0, 12);
  return <section className="card"><h3>{label}</h3>
    {values.length > 2 && <div className="chart" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartValues} layout="vertical" margin={{ left: 5, right: 18 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 11 }} />
          <Tooltip /><Bar dataKey="count" fill="var(--accent)" radius={[0, 5, 5, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>}
    {values.length > chartValues.length && <p className="hint">Chart shows the 12 largest groups. All groups remain in the filter list.</p>}
    <div className="distribution-list">{values.map(value => <button key={value.name} onClick={() => select(value.name)}>
      <span>{value.name}</span><strong>{value.count}</strong>
    </button>)}</div>
    {!values.length && <p className="hint">No reported findings in the current selection. Check assessment coverage.</p>}
  </section>;
}

export function Heatmap({ components, findings, choose }: {
  components: Component[]; findings: Finding[]; choose: (componentId: string, category: string) => void;
}) {
  const allCategories = breakdown(findings, "category").map(row => row.name);
  const allRows = components.filter(component => findings.some(finding => finding.componentIds.includes(component.id)));
  const categories = allCategories.slice(0, 12);
  const rows = allRows.slice(0, 60);
  if (!rows.length || !categories.length) return <p className="hint">A component/category heatmap requires findings with supported component mappings.</p>;
  return <div className="table-scroll"><table className="heatmap"><caption>Reported findings by component and category</caption>
    <thead><tr><th scope="col">Component</th>{categories.map(category => <th scope="col" key={category}>{category}</th>)}</tr></thead>
    <tbody>{rows.map(component => <tr key={component.id}><th scope="row">{component.name}</th>
      {categories.map(category => {
        const count = findings.filter(finding => finding.category === category && finding.componentIds.includes(component.id)).length;
        return <td key={category}><button className={count ? "heat-present" : "heat-zero"} disabled={!count}
          aria-label={`${component.name}, ${category}: ${count} finding associations`} onClick={() => choose(component.id, category)}>{count}</button></td>;
      })}
    </tr>)}</tbody>
  </table><p className="hint">Cells count finding-to-component associations. A finding may affect more than one component. Showing {rows.length} of {allRows.length} components and {categories.length} of {allCategories.length} categories; use the findings table for every location.</p></div>;
}
