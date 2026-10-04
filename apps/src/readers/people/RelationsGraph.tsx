import { useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { graphOf, layoutGraph, neighbourhood, NODE_H, NODE_W, type GraphEdge } from "./graphLayout";
import type { CastView } from "./model";
import { linkWords } from "./relations";

type RelationsGraphProps = {
  cast: CastView;
  /** The person the drawing is centred on; null draws everyone. */
  focus: string | null;
  onOpen: (person: string) => void;
};

/** A cast of more than this is drawn a neighbourhood at a time unless the reader asks for everyone. */
export const WHOLE_CAST = 24;

const path = (points: GraphEdge["points"]) => points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");
const short = (name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name);

/**
 * Who is tied to whom, as far as the reader has got: families as trees
 * (parents above children, couples side by side), other ties as lines with a
 * word on them, each person in their group's colour. It is drawn from the
 * cast as seen from the place being read, so no one not yet met is in it.
 *
 * Scrolls in both directions (drag it, or use the arrow keys); each person is
 * a button that opens their card.
 */
export const RelationsGraph = ({ cast, focus, onOpen }: RelationsGraphProps) => {
  const graph = useMemo(() => {
    const { people, links } = graphOf(cast);
    if (!focus) {
      return layoutGraph(people, links);
    }
    const near = neighbourhood(people, links, focus);
    return layoutGraph(
      people.filter((person) => near.has(person.id)),
      links
    );
  }, [cast, focus]);

  const frame = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const node = frame.current;
    if (!node || event.button !== 0) {
      return;
    }
    drag.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const node = frame.current;
    const from = drag.current;
    if (!node || !from) {
      return;
    }
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (!from.moved && Math.hypot(dx, dy) < 4) {
      return;
    }
    from.moved = true;
    node.scrollLeft = from.left - dx;
    node.scrollTop = from.top - dy;
  };
  const onPointerEnd = () => {
    // Left set for the click that follows a drag, which must not open a card.
    window.setTimeout(() => {
      drag.current = null;
    }, 0);
  };

  const open = (person: string) => {
    if (!drag.current?.moved) {
      onOpen(person);
    }
  };
  const onNodeKey = (event: KeyboardEvent<SVGGElement>, person: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      onOpen(person);
    }
  };

  if (graph.nodes.length === 0) {
    return <p className="reader-lookup-text reader-muted">No one to draw yet.</p>;
  }

  const nameOf = (id: string) => graph.nodes.find((node) => node.id === id)?.name ?? "";

  return (
    <div
      ref={frame}
      className="reader-people-graph reader-border"
      tabIndex={0}
      role="group"
      aria-label="Relations, drawn. Arrow keys scroll; each person opens their card."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerLeave={onPointerEnd}
    >
      <svg width={graph.width} height={graph.height} viewBox={`0 0 ${graph.width} ${graph.height}`} role="presentation">
        <g className="reader-people-edges">
          {graph.edges.map((edge) => {
            const tie = edge.type === "other" && edge.label ? `(${edge.label})` : linkWords(edge.type, true, edge.label);
            const words = `${nameOf(edge.from)} ${tie} ${nameOf(edge.to)}${edge.over ? " (ended)" : ""}`;
            const mid = edge.points[Math.floor((edge.points.length - 1) / 2)];
            const next = edge.points[Math.floor((edge.points.length - 1) / 2) + 1] ?? mid;
            return (
              <g key={edge.id} className={`reader-people-edge is-${edge.kind}${edge.over ? " is-over" : ""}`}>
                <title>{words}</title>
                <path d={path(edge.points)} />
                {edge.kind === "other" && (
                  <text x={(mid[0] + next[0]) / 2} y={(mid[1] + next[1]) / 2 - 4} textAnchor="middle">
                    {short(edge.label ?? linkWords(edge.type, true, null))}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {graph.nodes.map((node) => (
          <g
            key={node.id}
            className={node.id === focus ? "reader-people-node is-focus" : "reader-people-node"}
            data-color={node.color ?? undefined}
            transform={`translate(${node.x} ${node.y})`}
            role="button"
            tabIndex={0}
            aria-label={`${node.name}: open their card`}
            onClick={() => open(node.id)}
            onKeyDown={(event) => onNodeKey(event, node.id)}
          >
            <title>{node.name}</title>
            <rect width={NODE_W} height={NODE_H} rx={9} />
            <text x={NODE_W / 2} y={NODE_H / 2} textAnchor="middle" dominantBaseline="central">
              {short(node.name)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};
