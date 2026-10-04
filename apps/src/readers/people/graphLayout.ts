/**
 * Where the people and their links go in the relations drawing.
 *
 * Families are trees: parents in a row above their children, a couple side by
 * side, each family beside the last. Everyone without a family link sits in
 * rows below, near the people they are otherwise tied to; those ties (serves,
 * friend, enemy…) are lines with a word on them.
 *
 * It is given the cast as seen from the place being read (`graphOf`), so it
 * cannot draw someone not yet met or a link not yet known: they are not in
 * what it is given.
 *
 * Pure: people and links in, positions out. The same input in any order gives
 * the same drawing.
 */
import { FAMILY_LINKS, type CastView, type LinkType } from "./model";

export type GraphPerson = { id: string; name: string; color: string | null };
export type GraphLink = { id: string; type: LinkType; from: string; to: string; label: string | null; over: boolean };

export type GraphNode = GraphPerson & { x: number; y: number };
export type GraphEdge = {
  id: string;
  kind: "parent" | "spouse" | "sibling" | "other";
  type: LinkType;
  from: string;
  to: string;
  label: string | null;
  over: boolean;
  /** The line, corner to corner. */
  points: Array<[number, number]>;
};
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number };

export const NODE_W = 128;
export const NODE_H = 36;
const GAP_X = 28;
const GAP_Y = 56;
const PAD = 24;
/** Families are set side by side up to this width, then start a new band. */
const BAND_W = 1400;

/** The people and links of a cast, each link once. */
export const graphOf = (cast: CastView): { people: GraphPerson[]; links: GraphLink[] } => {
  const links = new Map<string, GraphLink>();
  for (const person of cast.people) {
    for (const link of person.links) {
      if (link.outward && !links.has(link.id)) {
        links.set(link.id, { id: link.id, type: link.type, from: person.id, to: link.other, label: link.label, over: link.over });
      }
    }
  }
  return {
    people: cast.people.map((person) => ({ id: person.id, name: person.name, color: person.color })),
    links: [...links.values()]
  };
};

/** Links between people who are both there, each once, in a fixed order. */
const usable = (people: GraphPerson[], links: GraphLink[]) => {
  const ids = new Set(people.map((person) => person.id));
  const seen = new Set<string>();
  return [...links]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((link) => {
      if (!ids.has(link.from) || !ids.has(link.to) || link.from === link.to || seen.has(link.id)) {
        return false;
      }
      seen.add(link.id);
      return true;
    });
};

/**
 * Someone and the people within `steps` links of them: what is drawn for a
 * large cast until the reader asks for everyone.
 */
export const neighbourhood = (people: GraphPerson[], links: GraphLink[], focus: string, steps = 2): Set<string> => {
  const near = new Map<string, string[]>();
  for (const link of usable(people, links)) {
    near.set(link.from, [...(near.get(link.from) ?? []), link.to]);
    near.set(link.to, [...(near.get(link.to) ?? []), link.from]);
  }
  const found = new Set<string>();
  if (!people.some((person) => person.id === focus)) {
    return found;
  }
  found.add(focus);
  let edge = [focus];
  for (let step = 0; step < steps; step += 1) {
    const next: string[] = [];
    for (const id of edge) {
      for (const other of near.get(id) ?? []) {
        if (!found.has(other)) {
          found.add(other);
          next.push(other);
        }
      }
    }
    edge = next;
  }
  return found;
};

export const layoutGraph = (allPeople: GraphPerson[], allLinks: GraphLink[]): Graph => {
  const people = [...new Map(allPeople.map((person) => [person.id, person])).values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
  const links = usable(people, allLinks);
  const byId = new Map(people.map((person) => [person.id, person]));
  const family = links.filter((link) => FAMILY_LINKS.includes(link.type));
  const others = links.filter((link) => !FAMILY_LINKS.includes(link.type));

  // ---- Generations: a child is one row below a parent; a couple, and
  // brothers and sisters, share a row. Where the links disagree, the first wins.
  const ties = new Map<string, Array<{ other: string; down: number }>>();
  const tie = (a: string, b: string, down: number) => {
    ties.set(a, [...(ties.get(a) ?? []), { other: b, down }]);
    ties.set(b, [...(ties.get(b) ?? []), { other: a, down: -down }]);
  };
  for (const link of family) {
    // "child": from is the child, to the parent.
    tie(link.to, link.from, link.type === "child" ? 1 : 0);
  }
  const row = new Map<string, number>();
  const families: string[][] = [];
  for (const person of people) {
    if (row.has(person.id) || !ties.has(person.id)) {
      continue;
    }
    const members = [person.id];
    row.set(person.id, 0);
    for (let at = 0; at < members.length; at += 1) {
      for (const { other, down } of ties.get(members[at]) ?? []) {
        if (!row.has(other)) {
          row.set(other, (row.get(members[at]) as number) + down);
          members.push(other);
        }
      }
    }
    const top = Math.min(...members.map((id) => row.get(id) as number));
    members.forEach((id) => row.set(id, (row.get(id) as number) - top));
    families.push(members);
  }

  const place = new Map<string, { x: number; y: number }>();
  const parentsOf = new Map<string, string[]>();
  const partner = new Map<string, string[]>();
  for (const link of family) {
    if (link.type === "child") {
      parentsOf.set(link.from, [...(parentsOf.get(link.from) ?? []), link.to]);
    } else if (link.type === "spouse") {
      partner.set(link.from, [...(partner.get(link.from) ?? []), link.to]);
      partner.set(link.to, [...(partner.get(link.to) ?? []), link.from]);
    }
  }

  const slot = NODE_W + GAP_X;
  let bandX = PAD;
  let bandY = PAD;
  let bandHeight = 0;
  let width = PAD;

  for (const members of families) {
    const rows: string[][] = [];
    for (const id of members) {
      const at = row.get(id) as number;
      (rows[at] ??= []).push(id);
    }
    const order = new Map<string, number>();
    for (let at = 0; at < rows.length; at += 1) {
      const line = (rows[at] ?? []).sort((a, b) => (byId.get(a) as GraphPerson).name.localeCompare((byId.get(b) as GraphPerson).name) || a.localeCompare(b));
      // Under their parents, as far as a row allows.
      const under = (id: string) => {
        const above = (parentsOf.get(id) ?? []).map((parent) => order.get(parent)).filter((n): n is number => n !== undefined);
        return above.length > 0 ? above.reduce((sum, n) => sum + n, 0) / above.length : Infinity;
      };
      const sorted = line
        .map((id, index) => ({ id, key: under(id), index }))
        .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key - b.key))
        .map((item) => item.id);
      // A couple side by side.
      const placed: string[] = [];
      for (const id of sorted) {
        if (placed.includes(id)) {
          continue;
        }
        placed.push(id);
        for (const other of partner.get(id) ?? []) {
          if (sorted.includes(other) && !placed.includes(other)) {
            placed.push(other);
          }
        }
      }
      rows[at] = placed;
      placed.forEach((id, index) => order.set(id, index));
    }
    const widest = Math.max(...rows.map((line) => (line ?? []).length));
    const familyWidth = widest * slot - GAP_X;
    const familyHeight = rows.length * (NODE_H + GAP_Y) - GAP_Y;
    if (bandX > PAD && bandX + familyWidth > BAND_W) {
      bandX = PAD;
      bandY += bandHeight + GAP_Y * 1.5;
      bandHeight = 0;
    }
    rows.forEach((line, at) => {
      const inset = (familyWidth - ((line ?? []).length * slot - GAP_X)) / 2;
      (line ?? []).forEach((id, index) => {
        place.set(id, { x: Math.round(bandX + inset + index * slot), y: Math.round(bandY + at * (NODE_H + GAP_Y)) });
      });
    });
    bandX += familyWidth + GAP_X * 2;
    bandHeight = Math.max(bandHeight, familyHeight);
    width = Math.max(width, bandX - GAP_X * 2 + PAD);
  }

  // ---- Everyone else, in rows below: people tied to each other next to each other.
  const loose = people.filter((person) => !place.has(person.id));
  if (loose.length > 0) {
    const near = new Map<string, string[]>();
    for (const link of others) {
      near.set(link.from, [...(near.get(link.from) ?? []), link.to]);
      near.set(link.to, [...(near.get(link.to) ?? []), link.from]);
    }
    const looseIds = new Set(loose.map((person) => person.id));
    const inOrder: string[] = [];
    const taken = new Set<string>();
    const starts = [...loose].sort(
      (a, b) => (near.get(b.id)?.length ?? 0) - (near.get(a.id)?.length ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    );
    for (const start of starts) {
      if (taken.has(start.id)) {
        continue;
      }
      const queue = [start.id];
      taken.add(start.id);
      for (let at = 0; at < queue.length; at += 1) {
        inOrder.push(queue[at]);
        for (const other of [...(near.get(queue[at]) ?? [])].sort()) {
          if (looseIds.has(other) && !taken.has(other)) {
            taken.add(other);
            queue.push(other);
          }
        }
      }
    }
    const columns = Math.max(3, Math.min(Math.ceil(Math.sqrt(inOrder.length * 1.6)), Math.floor((BAND_W - PAD) / slot)));
    const top = families.length > 0 ? bandY + bandHeight + GAP_Y * 1.5 : PAD;
    inOrder.forEach((id, index) => {
      // Rows are spread a little further apart: the ties between them carry a word.
      place.set(id, {
        x: Math.round(PAD + (index % columns) * slot),
        y: Math.round(top + Math.floor(index / columns) * (NODE_H + GAP_Y))
      });
    });
    width = Math.max(width, PAD + Math.min(columns, inOrder.length) * slot - GAP_X + PAD);
  }

  const nodes: GraphNode[] = people.map((person) => ({ ...person, ...(place.get(person.id) as { x: number; y: number }) }));
  const at = (id: string) => place.get(id) as { x: number; y: number };
  const centre = (id: string): [number, number] => [at(id).x + NODE_W / 2, at(id).y + NODE_H / 2];

  const edges: GraphEdge[] = links.map((link) => {
    const base = { id: link.id, type: link.type, from: link.from, to: link.to, label: link.label, over: link.over };
    const a = at(link.from);
    const b = at(link.to);
    if (link.type === "child" && b.y < a.y) {
      // From under the parent, across, down to the child.
      const mid = a.y - GAP_Y / 2;
      return {
        ...base,
        kind: "parent" as const,
        points: [
          [b.x + NODE_W / 2, b.y + NODE_H],
          [b.x + NODE_W / 2, mid],
          [a.x + NODE_W / 2, mid],
          [a.x + NODE_W / 2, a.y]
        ]
      };
    }
    if ((link.type === "spouse" || link.type === "sibling") && a.y === b.y) {
      const [left, right] = a.x <= b.x ? [a, b] : [b, a];
      if (link.type === "spouse" && right.x - left.x === slot) {
        return {
          ...base,
          kind: "spouse" as const,
          points: [
            [left.x + NODE_W, left.y + NODE_H / 2],
            [right.x, right.y + NODE_H / 2]
          ]
        };
      }
      // Over the heads of anyone between them.
      const lift = link.type === "spouse" ? 10 : 16;
      return {
        ...base,
        kind: link.type === "spouse" ? ("spouse" as const) : ("sibling" as const),
        points: [
          [left.x + NODE_W / 2, left.y],
          [left.x + NODE_W / 2, left.y - lift],
          [right.x + NODE_W / 2, right.y - lift],
          [right.x + NODE_W / 2, right.y]
        ]
      };
    }
    const kind = link.type === "child" ? "parent" : link.type === "spouse" ? "spouse" : link.type === "sibling" ? "sibling" : "other";
    return { ...base, kind, points: [centre(link.from), centre(link.to)] };
  });

  const height = nodes.reduce((max, node) => Math.max(max, node.y + NODE_H), 0) + PAD;
  return { nodes, edges, width: Math.max(width, nodes.reduce((max, node) => Math.max(max, node.x + NODE_W), 0) + PAD), height };
};
