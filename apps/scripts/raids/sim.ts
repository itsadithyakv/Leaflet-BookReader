/**
 * The raids' balance, measured (the raids plan, 2026-10-24, section 4), as the
 * Front's was: every stronghold of the Magpie Lands (0 to 17) and the King,
 * fought at "par" (the hut a reader has by then), by two plans:
 *
 * - the naive plan: everyone down the trail in one group, nobody held back,
 *   no orders (`squad.ts` `naiveSquad`);
 * - a good plan, found by searching approaches, squad mixes and splits, then
 *   a few orders at a few timings.
 *
 * Run from `apps/`: `npx vite-node scripts/raids/sim.ts` (add `--quick` for a
 * smaller search). It prints the tables that go in
 * docs/design/hollow/raids-balance-results.md, and the targets met or not.
 *
 * Par: a stronghold's region is its place on the ladder over three (the
 * Lands' five regions, three strongholds each), and the regions' fog lifts
 * with the chapters two at a time, as the burrow's levels do (`chapters.ts`
 * `burrowOfChapter`). The hut can be built no higher than the burrow, so a
 * reader in region r has the hut at r + 1 at most, and the sim takes that: it
 * is what the chapter allows, and a hut is cheap beside a burrow's chapter.
 * No fork, no tip, no hero (a hero is extra, from books finished).
 */
import { BATTLE_TICK, Battle, DROP_STRONGHOLD, RAID_FIGURES, type Result, type ScoutKind, type Setup, type Squad, type SquadGroup } from "../../src/pip/base/battle";
import { quirkOf } from "../../src/pip/base/quirks";
import { ordersAt, type Order } from "../../src/pip/base/orders";
import { ROOM, naiveSquad, planned } from "../../src/pip/base/squad";

const QUICK = process.argv.includes("--quick");
/** `--naive`: the naive plan alone (quick, for tuning the camps before the search). */
const NAIVE = process.argv.includes("--naive");
// TUNE='{"planned":{"sturdy":1.4}}' tries other figures (merged into `RAID_FIGURES`), for tuning.
const merge = (into: Record<string, unknown>, from: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(from)) {
    if (value && typeof value === "object" && into[key] && typeof into[key] === "object") merge(into[key] as Record<string, unknown>, value as Record<string, unknown>);
    else into[key] = value;
  }
};
if (process.env.TUNE) merge(RAID_FIGURES as unknown as Record<string, unknown>, JSON.parse(process.env.TUNE));
const STRONGHOLDS = 18;
const KING_N = 13;
/** Shaken runs each plan is judged by (jitter 0 is the raid as fought). */
const JUDGE = QUICK ? [0, 1] : [0, 1, 2];
const REPORT = [0, 1, 2, 3, 4];

const TRAINED_AT: Record<ScoutKind, number> = { sprout: 1, slinger: 2, bomber: 3, mole: 4 };
const tierOf = (n: number) => Math.min(4, Math.floor(n / 3));
const parHut = (n: number) => Math.min(5, Math.floor(n / 3) + 1);
const lordOf = (n: number) => ((n + 1) % 3 === 0 ? tierOf(n) : null);

const setupAt = (n: number, hut: number, king = false): Setup => ({
  n,
  king,
  capacity: 5 + 2 * hut,
  level: hut,
  kinds: (Object.keys(TRAINED_AT) as ScoutKind[]).filter((kind) => hut >= TRAINED_AT[kind]),
  fast: false,
  seed: 0,
  hero: null,
  champion: king ? 5 : lordOf(n),
  drop: DROP_STRONGHOLD,
  bombers: hut >= 5 ? 2 : hut >= 3 ? 1 : 0
});

let raids = 0;
let raidMs = 0;
const play = (setup: Setup, jitter: number): Result => {
  const started = performance.now();
  const battle = new Battle({ ...setup, jitter });
  while (!battle.over) battle.step(BATTLE_TICK);
  raidMs += performance.now() - started;
  raids += 1;
  return battle.result();
};
const judge = (setup: Setup, runs = JUDGE) => {
  let stars = 0;
  let destroyed = 0;
  for (const jitter of runs) {
    const result = play(setup, jitter);
    stars += result.stars;
    destroyed += result.destroyed;
  }
  return { stars: stars / runs.length, score: (stars + destroyed * 0.3) / runs.length };
};

// ---- the search ----------------------------------------------------------------

type Mix = Partial<Record<ScoutKind, number>>;
const roomOfMix = (mix: Mix) => (Object.keys(mix) as ScoutKind[]).reduce((sum, kind) => sum + (mix[kind] ?? 0) * ROOM[kind], 0);

/** Mixes worth trying: Puffcaps, moles and slingers in a few amounts, sprouts for the rest of the room. */
const mixesFor = (setup: Setup): Mix[] => {
  const has = (kind: ScoutKind) => setup.kinds.includes(kind);
  const out: Mix[] = [];
  const bombers = has("bomber") ? [0, Math.min(1, setup.bombers ?? 0), setup.bombers ?? 0] : [0];
  for (const bomber of [...new Set(bombers)]) {
    const left = setup.capacity - bomber * ROOM.bomber;
    const moles = has("mole") ? [0, Math.floor(left / 6), Math.floor(left / 3)] : [0];
    for (const mole of [...new Set(moles)]) {
      const rest = left - mole * ROOM.mole;
      const slingers = has("slinger") ? [0, Math.floor(rest * 0.35), Math.floor(rest * 0.7)] : [0];
      for (const slinger of [...new Set(slingers)]) {
        const mix: Mix = { sprout: rest - slinger };
        if (slinger) mix.slinger = slinger;
        if (mole) mix.mole = mole;
        if (bomber) mix.bomber = bomber;
        if (roomOfMix(mix) <= setup.capacity) out.push(mix);
      }
    }
  }
  return QUICK ? out.filter((_, index) => index % 2 === 0) : out;
};

/** A share of a mix (rounded down, each kind), and what is left. */
const part = (mix: Mix, share: number): [Mix, Mix] => {
  const a: Mix = {};
  const b: Mix = {};
  for (const kind of Object.keys(mix) as ScoutKind[]) {
    const take = Math.floor((mix[kind] ?? 0) * share);
    if (take) a[kind] = take;
    if ((mix[kind] ?? 0) - take) b[kind] = (mix[kind] ?? 0) - take;
  }
  return [a, b];
};
/** One kind out of a mix, into a group of its own. */
const pull = (mix: Mix, kind: ScoutKind): [Mix, Mix] => {
  const rest = { ...mix };
  delete rest[kind];
  return [{ [kind]: mix[kind] ?? 0 }, rest];
};
const empty = (mix: Mix) => roomOfMix(mix) === 0;

/** Ways to split a mix across a camp's approaches. */
const squadsFor = (mix: Mix, ways: number): Squad[] => {
  const out: Squad[] = [];
  const add = (groups: SquadGroup[]) => {
    const kept = groups.filter((entry) => !empty(entry.scouts));
    if (kept.length > 0) out.push({ groups: kept });
  };
  for (let a = 0; a < ways; a++) {
    add([{ scouts: mix, approach: a }]);
    for (let b = 0; b < ways; b++) {
      if (b !== a) {
        const [side, main] = part(mix, 1 / 3);
        add([{ scouts: main, approach: a }, { scouts: side, approach: b }]);
        add([{ scouts: main, approach: a }, { scouts: side, approach: b, held: true }]);
        for (const kind of ["mole", "slinger", "bomber"] as const) {
          if (!mix[kind]) continue;
          const [own, rest] = pull(mix, kind);
          add([{ scouts: rest, approach: a }, { scouts: own, approach: b }]);
        }
      }
      // Sprouts first, down the trail; the rest held, then in by a or b.
      if ((mix.sprout ?? 0) >= 3) {
        const lead = Math.min(3, mix.sprout ?? 0);
        add([{ scouts: { sprout: lead }, approach: 0 }, { scouts: { ...mix, sprout: (mix.sprout ?? 0) - lead }, approach: b, held: true }]);
      }
    }
  }
  return out;
};

type Plan = { squad: Squad; orders: Order[] };
const describe = (plan: Plan, battle: Battle): string => {
  const kinds: Record<ScoutKind, string> = { sprout: "sp", slinger: "sl", mole: "mo", bomber: "pc" };
  const groups = plan.squad.groups
    .map((entry) => {
      const scouts = (Object.keys(entry.scouts) as ScoutKind[]).map((kind) => `${entry.scouts[kind]}${kinds[kind]}`).join("+");
      return `${scouts}@${battle.approaches[entry.approach]?.kind ?? "?"}${entry.held ? "(held)" : ""}`;
    })
    .join(" / ");
  const orders = plan.orders
    .map((order) => {
      const at = `${(order.tick * BATTLE_TICK).toFixed(0)}s`;
      if (order.kind === "rally") {
        const target = battle.structures[order.target];
        return `rally g${order.group}->${target?.crow ? "crow" : target?.kind}@${at}`;
      }
      return `${order.kind}@${at}`;
    })
    .join(", ");
  return orders ? `${groups}; ${orders}` : groups;
};

const search = (setup: Setup): { plan: Plan; stars: number } => {
  const look = new Battle(planned(setup, { groups: [] }));
  const ways = look.approaches.length;
  // Squads first, without orders.
  const tried: Array<{ plan: Plan; score: number; stars: number }> = [];
  for (const mix of mixesFor(setup)) {
    for (const squad of squadsFor(mix, ways)) {
      const judged = judge(planned(setup, squad));
      tried.push({ plan: { squad, orders: [] }, ...judged });
    }
  }
  tried.sort((a, b) => b.score - a.score);
  // Then orders, one at a time, on the best few: a rally to the nest, the crow or a perch, a release, at a few moments.
  const targets = look.structures.filter((entry) => entry.kind !== "wall" && !entry.flat).map((entry) => entry.id);
  const moments = QUICK ? [0, 150] : [0, 90, 210, 360];
  const allowed = ordersAt(setup.level);
  let best = tried[0];
  for (const start of tried.slice(0, QUICK ? 2 : 4)) {
    let current = start;
    for (let round = 0; round < Math.min(allowed, QUICK ? 1 : 2); round++) {
      let improved = current;
      const candidates: Order[] = [];
      for (const tick of moments) {
        if (current.plan.squad.groups.some((entry) => entry.held)) candidates.push({ tick, kind: "release" });
        current.plan.squad.groups.forEach((_, index) => {
          for (const target of targets) candidates.push({ tick, kind: "rally", group: index, target });
        });
      }
      for (const order of candidates) {
        const orders = [...current.plan.orders, order];
        const judged = judge(planned(setup, current.plan.squad, orders));
        if (judged.score > improved.score + 1e-9) improved = { plan: { squad: current.plan.squad, orders }, ...judged };
      }
      if (improved === current) break;
      current = improved;
      if (current.stars >= 3) break;
    }
    if (current.score > best.score) best = current;
    if (best.stars >= 3) break;
  }
  return { plan: best.plan, stars: best.stars };
};

// ---- the named counters ----------------------------------------------------------

/**
 * Each quirk's counter as the scout view names it ("What beats it"), made
 * into a plan by rule, with no search: so the table can say that the counter
 * the game teaches is itself worth its stars, and not only whatever the
 * search found.
 */
const counterPlan = (setup: Setup, look: Battle): Plan => {
  const ways = look.approaches;
  const trail = Math.max(0, ways.findIndex((way) => way.kind === "trail"));
  const flank = Math.max(0, ways.findIndex((way) => way.kind !== "trail" && way.hazard !== null) >= 0 ? ways.findIndex((way) => way.kind !== "trail" && way.hazard !== null) : ways.findIndex((way) => way.kind !== "trail"));
  const has = (kind: ScoutKind) => setup.kinds.includes(kind);
  const room = setup.capacity;
  const at = (seconds: number) => Math.round(seconds / BATTLE_TICK);
  const nest = 0;
  const rallyAll = (groups: SquadGroup[], seconds: number): Order[] => groups.map((_, group) => ({ tick: at(seconds), kind: "rally", group, target: nest }) as Order);
  switch (look.quirk) {
    case "ford": {
      // Moles wade nothing: they take the ford; everyone else goes round.
      const moles = has("mole") ? Math.floor(room / 2 / ROOM.mole) : 0;
      const groups: SquadGroup[] = [{ scouts: { sprout: room - moles * ROOM.mole }, approach: flank }];
      if (moles) groups.push({ scouts: { mole: moles }, approach: trail });
      return { squad: { groups }, orders: rallyAll(groups, 3) };
    }
    case "crow": {
      // Silence its perch first, then the nest.
      const crow = look.structures.find((entry) => entry.crow)?.id ?? nest;
      const groups: SquadGroup[] = [{ scouts: { sprout: room }, approach: flank }];
      return { squad: { groups }, orders: [{ tick: 0, kind: "rally", group: 0, target: crow }, { tick: at(15), kind: "rally", group: 0, target: nest }] };
    }
    case "pits": {
      // Sprouts first, down the trail, to spring them; the rest held, then in behind.
      const lead = 3;
      const groups: SquadGroup[] = [
        { scouts: { sprout: lead }, approach: trail },
        { scouts: { sprout: room - lead - (has("slinger") ? Math.floor(room * 0.3) : 0), ...(has("slinger") ? { slinger: Math.floor(room * 0.3) } : {}) }, approach: trail, held: true }
      ];
      return { squad: { groups }, orders: [{ tick: at(5), kind: "release" }, { tick: at(15), kind: "rally", group: 1, target: nest }] };
    }
    case "fog": {
      // Slingers walk right up: the perches cannot see as far as they throw.
      const slingers = has("slinger") ? Math.floor(room * 0.7) : 0;
      const groups: SquadGroup[] = [{ scouts: { sprout: room - slingers, ...(slingers ? { slinger: slingers } : {}) }, approach: trail }];
      return { squad: { groups }, orders: rallyAll(groups, 10) };
    }
    case "gate": {
      // Use the weak gate: everyone round to it, the stout one left alone; the nest once the camp is thinned.
      const groups: SquadGroup[] = [{ scouts: { sprout: room }, approach: flank }];
      return { squad: { groups }, orders: [{ tick: at(20), kind: "rally", group: 0, target: nest }] };
    }
    case "hedge": {
      // Moles go under it; the rest go round.
      const moles = has("mole") ? Math.floor(room / 2 / ROOM.mole) : 0;
      const groups: SquadGroup[] = [{ scouts: { mole: moles }, approach: trail }, { scouts: { sprout: room - moles * ROOM.mole }, approach: flank }];
      return { squad: { groups }, orders: rallyAll(groups, 10) };
    }
    default:
      return { squad: naiveSquad(setup), orders: [] };
  }
};

// ---- the table ---------------------------------------------------------------------

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const fmt = (value: number) => value.toFixed(2);

type Row = { name: string; n: number; king: boolean; quirk: string; hut: number; naive: number; naiveRuns: number[]; good: number; goodRuns: number[]; lord: boolean; byHut: number[]; plan: string; counter: number; counterRuns: number[] };
const rows: Row[] = [];
const began = performance.now();
// ONLY=0,1,2 runs those strongholds alone (18 is the King): for tuning one region.
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
for (let index = 0; index <= STRONGHOLDS; index++) {
  if (only && !only.has(index)) continue;
  const king = index === STRONGHOLDS;
  const n = king ? KING_N : index;
  const hut = king ? 5 : parHut(n);
  const setup = setupAt(n, hut, king);
  const naiveSetup = planned(setup, naiveSquad(setup));
  const naiveRuns = REPORT.map((jitter) => play(naiveSetup, jitter).stars);
  const found = NAIVE ? { plan: { squad: naiveSquad(setup), orders: [] }, stars: 0 } : search(setup);
  const goodSetup = planned(setup, found.plan.squad, found.plan.orders);
  const goodRuns = REPORT.map((jitter) => play(goodSetup, jitter).stars);
  const byHut = [1, 2, 3, 4, 5].map((level) => {
    const at = setupAt(n, level, king);
    return mean(REPORT.map((jitter) => play(planned(at, naiveSquad(at)), jitter).stars));
  });
  const named = counterPlan(setup, new Battle(planned(setup, { groups: [] })));
  const counterRuns = REPORT.map((jitter) => play(planned(setup, named.squad, named.orders), jitter).stars);
  rows.push({
    counter: mean(counterRuns),
    counterRuns,
    name: king ? "King" : `${n + 1}`,
    n,
    king,
    quirk: quirkOf(n, king, 0) ?? "none",
    hut,
    naive: mean(naiveRuns),
    naiveRuns,
    good: mean(goodRuns),
    goodRuns,
    lord: !king && lordOf(n) !== null,
    byHut,
    plan: describe(found.plan, new Battle(goodSetup))
  });
  process.stderr.write(`${rows[rows.length - 1].name} `);
}
process.stderr.write("\n");

const out: string[] = [];
out.push("| Stronghold | Quirk | Par hut | Naive ★ (5 runs) | Good ★ (5 runs) | Gap | Naive by hut 1 / 2 / 3 / 4 / 5 | Good plan |");
out.push("|---|---|---|---|---|---|---|---|");
for (const row of rows) {
  out.push(
    `| ${row.name}${row.lord ? " (keep)" : ""} | ${row.quirk} | ${row.hut} | ${fmt(row.naive)} (${row.naiveRuns.join("")}) | ${fmt(row.good)} (${row.goodRuns.join("")}) | ${fmt(row.good - row.naive)} | ${row.byHut.map((value) => value.toFixed(1)).join(" / ")} | ${row.plan} |`
  );
}
out.push("");
out.push("| Quirk | Strongholds | Naive ★ | Good ★ | Counter worth (good − naive) | The named counter, by rule ★ | Named counter − naive |");
out.push("|---|---|---|---|---|---|---|");
for (const quirk of ["ford", "crow", "pits", "fog", "gate", "hedge"]) {
  const of = rows.filter((row) => row.quirk === quirk);
  out.push(
    `| ${quirk} | ${of.map((row) => row.name).join(", ")} | ${fmt(mean(of.map((row) => row.naive)))} | ${fmt(mean(of.map((row) => row.good)))} | ${fmt(Math.min(...of.map((row) => row.good - row.naive)))} least, ${fmt(mean(of.map((row) => row.good - row.naive)))} mean | ${of.map((row) => `${fmt(row.counter)} (${row.counterRuns.join("")})`).join(", ")} | ${fmt(mean(of.map((row) => row.counter - row.naive)))} mean |`
  );
}

// The targets.
const ladder = rows.filter((row) => !row.king);
const naiveMean = mean(rows.map((row) => row.naive));
const threeShare = mean(rows.map((row) => row.goodRuns.filter((stars) => stars === 3).length / row.goodRuns.length));
const gap = mean(rows.map((row) => row.good - row.naive));
const lostFrom2 = ladder.filter((row) => row.n >= 3 && row.naiveRuns.some((stars) => stars === 0)).map((row) => row.name);
const counters = ["ford", "crow", "pits", "fog", "gate", "hedge"].map((quirk) => ({ quirk, least: Math.min(...rows.filter((row) => row.quirk === quirk).map((row) => row.good - row.naive)) }));
// Each hut level on the next strongholds: a region's naive stars at its par hut, against one level up.
const regionSteps = [0, 1, 2, 3].map((region) => {
  const of = ladder.filter((row) => Math.floor(row.n / 3) === region);
  return mean(of.map((row) => row.byHut[row.hut])) - mean(of.map((row) => row.byHut[row.hut - 1]));
});
const hutSteps = ladder.filter((row) => row.hut < 5).map((row) => row.byHut[row.hut] - row.byHut[row.hut - 1]);
const lordsNot3 = rows.filter((row) => row.lord || row.king).every((row) => row.naiveRuns.every((stars) => stars < 3));
out.push("");
out.push("| Target | Aimed | Measured | Met |");
out.push("|---|---|---|---|");
out.push(`| Naive plan's mean at par | about 1★ | ${fmt(naiveMean)} | ${Math.abs(naiveMean - 1) <= 0.35 ? "yes" : "no"} |`);
out.push(`| Naive loses some from region 2 on | some 0★ | ${lostFrom2.length} strongholds with a 0★ run (${lostFrom2.join(", ")}) | ${lostFrom2.length > 0 ? "yes" : "no"} |`);
out.push(`| Good plan ★★★ | ≥ 90% | ${(threeShare * 100).toFixed(0)}% of runs | ${threeShare >= 0.9 ? "yes" : "no"} |`);
out.push(`| Gap, good − naive | ≥ 1.5★ | ${fmt(gap)} | ${gap >= 1.5 ? "yes" : "no"} |`);
out.push(`| Every quirk's counter worth | ≥ +1★ | ${counters.map((entry) => `${entry.quirk} ${fmt(entry.least)}`).join(", ")} (least each) | ${counters.every((entry) => entry.least >= 1) ? "yes" : "no"} |`);
out.push(
  `| A hut level up raises the naive plan on the next strongholds | +0.25★ or more, every level | hut 1→2 +${fmt(regionSteps[0])}, 2→3 +${fmt(regionSteps[1])}, 3→4 +${fmt(regionSteps[2])}, 4→5 +${fmt(regionSteps[3])} (region means); stronghold by stronghold +${fmt(mean(hutSteps))} on average, ${hutSteps.filter((step) => step <= 0).length} of ${hutSteps.length} flat, ${hutSteps.filter((step) => step < 0).length} lower | ${regionSteps.every((step) => step >= 0.25) && hutSteps.every((step) => step >= 0) ? "yes" : "no"} |`
);
out.push(`| Lords' keeps not ★★★ by the naive plan | none | ${lordsNot3 ? "none" : "some"} | ${lordsNot3 ? "yes" : "no"} |`);
out.push("");
out.push(`Raids simulated: ${raids}, ${fmt(raidMs / raids)} ms each (${((performance.now() - began) / 1000).toFixed(1)} s in all).`);
console.log(out.join("\n"));
