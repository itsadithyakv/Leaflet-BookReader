import { describe, expect, it } from "vitest";
import { graphOf, layoutGraph, neighbourhood, NODE_H, NODE_W, type GraphLink, type GraphPerson } from "./graphLayout";
import { castAt, type Entry, type LinkType } from "./model";

const person = (id: string, name = id): GraphPerson => ({ id, name, color: null });
const link = (id: string, from: string, type: LinkType, to: string, more: Partial<GraphLink> = {}): GraphLink => ({
  id,
  type,
  from,
  to,
  label: null,
  over: false,
  ...more
});

const STARKS = ["Ned", "Catelyn", "Robb", "Sansa", "Jon", "Rickard", "Benjen", "Theon", "Jory"].map((name) =>
  person(name.toLowerCase(), name)
);
const TIES: GraphLink[] = [
  link("1", "ned", "spouse", "catelyn"),
  link("2", "robb", "child", "ned"),
  link("3", "robb", "child", "catelyn"),
  link("4", "sansa", "child", "ned"),
  link("5", "sansa", "child", "catelyn"),
  link("6", "jon", "child", "ned"),
  link("7", "ned", "child", "rickard"),
  link("8", "benjen", "sibling", "ned"),
  link("9", "theon", "ward", "ned"),
  link("10", "jory", "serves", "ned", { label: "captain of the guard" })
];

type Drawn = ReturnType<typeof layoutGraph>;
const overlaps = (graph: Drawn) => {
  let count = 0;
  for (let a = 0; a < graph.nodes.length; a += 1) {
    for (let b = a + 1; b < graph.nodes.length; b += 1) {
      const one = graph.nodes[a];
      const two = graph.nodes[b];
      if (Math.abs(one.x - two.x) < NODE_W && Math.abs(one.y - two.y) < NODE_H) {
        count += 1;
      }
    }
  }
  return count;
};
const at = (graph: Drawn, id: string) => graph.nodes.find((node) => node.id === id) as { x: number; y: number };

describe("the relations drawing", () => {
  const graph = layoutGraph(STARKS, TIES);

  it("puts everyone somewhere, no one on top of anyone, inside the drawing", () => {
    expect(graph.nodes).toHaveLength(STARKS.length);
    expect(overlaps(graph)).toBe(0);
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + NODE_W).toBeLessThanOrEqual(graph.width);
      expect(node.y + NODE_H).toBeLessThanOrEqual(graph.height);
    }
  });

  it("sets generations in rows: parents above their children", () => {
    expect(at(graph, "rickard").y).toBeLessThan(at(graph, "ned").y);
    expect(at(graph, "ned").y).toBeLessThan(at(graph, "robb").y);
    expect(at(graph, "robb").y).toBe(at(graph, "sansa").y);
    expect(at(graph, "jon").y).toBe(at(graph, "sansa").y);
  });

  it("sets a couple side by side, and a brother in the same row", () => {
    expect(at(graph, "ned").y).toBe(at(graph, "catelyn").y);
    expect(Math.abs(at(graph, "ned").x - at(graph, "catelyn").x)).toBeLessThan(NODE_W * 1.5);
    expect(at(graph, "benjen").y).toBe(at(graph, "ned").y);
  });

  it("sets people with no family link below the trees", () => {
    const lowest = Math.max(...["rickard", "ned", "catelyn", "benjen", "robb", "sansa", "jon"].map((id) => at(graph, id).y));
    expect(at(graph, "theon").y).toBeGreaterThan(lowest);
    expect(at(graph, "jory").y).toBeGreaterThan(lowest);
  });

  it("draws every link once, between people who are drawn, with its word", () => {
    expect(graph.edges.map((edge) => edge.id).sort()).toEqual(TIES.map((tie) => tie.id).sort());
    expect(graph.edges.find((edge) => edge.id === "2")?.kind).toBe("parent");
    expect(graph.edges.find((edge) => edge.id === "1")?.kind).toBe("spouse");
    expect(graph.edges.find((edge) => edge.id === "8")?.kind).toBe("sibling");
    expect(graph.edges.find((edge) => edge.id === "10")).toMatchObject({ kind: "other", label: "captain of the guard" });
    for (const edge of graph.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      expect(edge.points.flat().every((n) => Number.isFinite(n))).toBe(true);
    }
  });

  it("a line from parent to child leaves the parent's foot and arrives at the child's head", () => {
    const edge = graph.edges.find((item) => item.id === "6") as Drawn["edges"][number];
    expect(edge.points[0]).toEqual([at(graph, "ned").x + NODE_W / 2, at(graph, "ned").y + NODE_H]);
    expect(edge.points[edge.points.length - 1]).toEqual([at(graph, "jon").x + NODE_W / 2, at(graph, "jon").y]);
  });

  it("is the same drawing whatever order it is given things in", () => {
    expect(layoutGraph([...STARKS].reverse(), [...TIES].reverse())).toEqual(graph);
  });

  it("draws no one it was not given, and no link to them", () => {
    const some = layoutGraph(
      STARKS.filter((item) => item.id !== "catelyn"),
      TIES
    );
    expect(some.nodes.map((node) => node.id)).not.toContain("catelyn");
    expect(some.edges.some((edge) => edge.from === "catelyn" || edge.to === "catelyn")).toBe(false);
    expect(layoutGraph([], TIES)).toMatchObject({ nodes: [], edges: [] });
  });

  it("survives links that contradict each other, a link to oneself and the same link twice", () => {
    const odd = layoutGraph(STARKS, [
      ...TIES,
      link("11", "ned", "child", "robb"),
      link("12", "jon", "sibling", "jon"),
      link("1", "ned", "spouse", "catelyn")
    ]);
    expect(odd.nodes).toHaveLength(STARKS.length);
    expect(overlaps(odd)).toBe(0);
    expect(odd.edges.filter((edge) => edge.id === "1")).toHaveLength(1);
    expect(odd.edges.some((edge) => edge.id === "12")).toBe(false);
  });

  it("lays out a very large cast without anyone overlapping, quickly", () => {
    const many = Array.from({ length: 600 }, (_, index) => person(`p${index}`, `Person ${String(index).padStart(3, "0")}`));
    const ties: GraphLink[] = [];
    for (let index = 1; index < 600; index += 1) {
      const type: LinkType = index % 7 === 0 ? "spouse" : index % 3 === 0 ? "child" : index % 5 === 0 ? "friend" : "serves";
      ties.push(link(`l${index}`, `p${index}`, type, `p${Math.floor(index / 3)}`));
    }
    const started = Date.now();
    const big = layoutGraph(many, ties);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(big.nodes).toHaveLength(600);
    expect(overlaps(big)).toBe(0);
  });
});

describe("someone's neighbourhood", () => {
  it("is them and the people within two links", () => {
    expect([...neighbourhood(STARKS, TIES, "jory")].sort()).toEqual(
      ["benjen", "catelyn", "jon", "jory", "ned", "rickard", "robb", "sansa", "theon"].sort()
    );
    expect([...neighbourhood(STARKS, TIES, "jory", 1)].sort()).toEqual(["jory", "ned"]);
    expect([...neighbourhood(STARKS, TIES, "rickard", 1)].sort()).toEqual(["ned", "rickard"]);
    expect(neighbourhood(STARKS, TIES, "nobody").size).toBe(0);
  });
});

describe("the drawing is made from the cast as seen from a place", () => {
  const stamp = (p: number) => ({ p, cfi: null, chapter: null });
  const made = { bookId: "b", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
  const sheet: Entry[] = [
    { ...made, id: "jon", at: stamp(0.1), kind: "person", name: "Jon" },
    { ...made, id: "ned", at: stamp(0.1), kind: "person", name: "Ned" },
    { ...made, id: "ygritte", at: stamp(0.6), kind: "person", name: "SPOILER Ygritte" },
    { ...made, id: "l1", at: stamp(0.1), kind: "link", person: "jon", to: "ned", type: "child", label: null, ended: stamp(0.8) },
    { ...made, id: "l2", at: stamp(0.6), kind: "link", person: "jon", to: "ygritte", type: "friend", label: "SPOILER lovers", ended: null },
    { ...made, id: "l3", at: stamp(0.5), kind: "link", person: "jon", to: "ned", type: "other", label: "SPOILER not his son", ended: null }
  ];

  it("has no node for someone not yet met, and no link not yet known", () => {
    const { people, links } = graphOf(castAt(sheet, { progress: 0.3 }));
    const graph = layoutGraph(people, links);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["jon", "ned"]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["l1"]);
    expect(graph.edges[0].over).toBe(false);
    expect(JSON.stringify(graph)).not.toContain("SPOILER");
    expect(JSON.stringify(graph)).not.toContain("ygritte");
  });

  it("has them all from the end, each link once", () => {
    const { people, links } = graphOf(castAt(sheet, { progress: 1 }));
    expect(people).toHaveLength(3);
    expect(links.map((item) => item.id).sort()).toEqual(["l1", "l2", "l3"]);
    expect(links.find((item) => item.id === "l1")?.over).toBe(true);
  });
});
