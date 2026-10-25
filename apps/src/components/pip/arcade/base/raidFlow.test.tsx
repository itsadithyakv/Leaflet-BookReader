import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../../../testing/miniDom";
import type { GameArt } from "../gameArt";
import type { Result, Squad } from "../../../../pip/base/battle";
import type { BaseState, FriendRaid, Now, Raid, RaidEnd } from "../../../../pip/base/rules";
import type { RaidAim } from "./RaidFlow";

/**
 * A raid on screen, from the map's hand-off to its end card (RaidFlow.tsx; raids-plan.md, sections 2, 3 and 5): scouting
 * marks the stronghold, the plan starts from the plan made without thinking and marks what is wrong with it, the
 * forecast waits for the plan to be still, every order given on screen reaches the battle and plays again from what it
 * kept, and the end card says why a star was missed. Send, a friend's camp, the King and a replay go the same way.
 */

const document = installMiniDom();
const DAY = "2026-10-24";
/** No canvas in the mini DOM: the art is never drawn, and a stand-in does. */
const art = { sprite: () => null, pose: () => null, pip: () => ({ image: {}, w: 32, h: 32, box: [0, 0, 32, 32] }) } as unknown as GameArt;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("a raid, on screen", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root | null = null;
  let RaidFlow: typeof import("./RaidFlow").RaidFlow;
  let RaidBattle: typeof import("./RaidBattle").RaidBattle;
  let RaidEndCard: typeof import("./RaidEndCard").RaidEndCard;
  let FORECAST_WAIT_MS: number;
  let rules: typeof import("../../../../pip/base/rules");
  let chapters: typeof import("../../../../pip/base/chapters");
  let battleMod: typeof import("../../../../pip/base/battle");
  let squadMod: typeof import("../../../../pip/base/squad");
  let lands: typeof import("../../../../pip/base/lands");
  let raidMark: typeof import("../../../../pip/base/raidMark");
  let feats: typeof import("../../../../pip/base/feats");
  let heroes: typeof import("../../../../pip/base/heroes");

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ RaidFlow } = await import("./RaidFlow"));
    ({ RaidBattle } = await import("./RaidBattle"));
    ({ RaidEndCard } = await import("./RaidEndCard"));
    ({ FORECAST_WAIT_MS } = await import("./RaidPlan"));
    rules = await import("../../../../pip/base/rules");
    chapters = await import("../../../../pip/base/chapters");
    battleMod = await import("../../../../pip/base/battle");
    squadMod = await import("../../../../pip/base/squad");
    lands = await import("../../../../pip/base/lands");
    raidMark = await import("../../../../pip/base/raidMark");
    feats = await import("../../../../pip/base/feats");
    heroes = await import("../../../../pip/base/heroes");
  }, 30_000);

  afterEach(async () => {
    if (root) await React.act(async () => root!.unmount());
    root = null;
    vi.restoreAllMocks();
  });

  const body = () => document.body as unknown as MiniElement;
  const all = (test: (element: MiniElement) => boolean) => body().findAll(test);
  const classes = (element: MiniElement) => (element.getAttribute("class") ?? "").split(" ");
  const byClass = (name: string) => all((element) => classes(element).includes(name));
  const button = (label: string | RegExp) =>
    all((element) => {
      if (element.tagName !== "BUTTON") return false;
      const said = element.getAttribute("aria-label") ?? element.textContent.trim();
      return typeof label === "string" ? said === label || element.textContent.trim() === label : label.test(said) || label.test(element.textContent.trim());
    })[0];
  const press = async (target: MiniElement | undefined, what = "something to press") => {
    expect(target, what).toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
  };
  /** Lets the field's frames (a timer each, in the mini DOM) run for a while. */
  const frames = async (ms = 120) => {
    await React.act(async () => wait(ms));
  };

  /** A camp in region 3, the hut at 4, rested, `camps` strongholds taken. */
  const camp = (camps = 7, more: Partial<BaseState> = {}): BaseState => {
    const minutes = chapters.chapterStartsAt(8) + 60;
    const base = rules.settle(rules.newBase(0, DAY), { minutes, day: DAY, lit: false });
    return { ...base, camps, raidFrom: -1000, acorns: 500, levels: { ...base.levels, burrow: 5, hut: 4 }, strongholds: { stars: [3, 2, 3, 1, 2, 3, 2].slice(0, camps), scouted: [] }, ...more };
  };
  const nowOf = (base: BaseState): Now => ({ minutes: base.minutes, day: DAY, lit: false });

  type Shown = {
    base: () => BaseState;
    started: Array<{ aim: RaidAim; squad: Squad }>;
    finished: Array<{ raid: Raid | FriendRaid; result: Result; end: RaidEnd | null }>;
    scouted: number[];
    closed: () => number;
  };
  /** The raid's screens over a camp kept here, as the camp's screen keeps it: Go spends the rest, the end is taken in. */
  const show = async (start: BaseState, aim: RaidAim, more: { sent?: { end: RaidEnd; raid: Raid } | null; forecast?: typeof import("../../../../pip/base/squad").forecastInSteps; result?: Result } = {}): Promise<Shown> => {
    let base = start;
    let closed = 0;
    const shown: Shown = { base: () => base, started: [], finished: [], scouted: [], closed: () => closed };
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    const render = () =>
      root!.render(
        <RaidFlow
          base={base}
          now={nowOf(base)}
          art={art}
          season={0}
          aim={aim}
          sent={more.sent ?? null}
          why={() => "The scouts are resting"}
          onScouted={(n) => {
            shown.scouted.push(n);
            base = lands.markScouted(base, n);
          }}
          onStart={(target, squad) => {
            shown.started.push({ aim: target, squad });
            if (target.kind === "friend") {
              const begun = rules.startFriendRaid(base, target.target.camp, { handle: target.target.handle, name: target.target.name }, nowOf(base), squad);
              if (!begun) return null;
              base = begun.state;
              return begun.raid;
            }
            const begun = rules.startRaid(base, target.target.kind, nowOf(base), false, target.target.slot, squad);
            if (!begun) return null;
            base = begun.state;
            return begun.raid;
          }}
          onFinish={(raid, fought) => {
            // (A test may say how the fight went: one ended at once is lost.)
            const result = more.result ?? fought;
            const ended = "friend" in raid ? rules.finishFriendRaid(base, raid as FriendRaid, result, DAY) : rules.finishRaid(base, raid, result, DAY);
            base = ended.state;
            shown.finished.push({ raid, result, end: ended.end });
            void Promise.resolve().then(() => React.act(async () => render()));
            return ended.end;
          }}
          onLoot={() => undefined}
          onClose={() => {
            closed += 1;
          }}
          forecast={more.forecast}
        />
      );
    await React.act(async () => render());
    return shown;
  };

  it("goes from the map's hand-off through scout, plan, Go and the fight to the end card", async () => {
    const shown = await show(camp(), { kind: "stronghold", target: { kind: "camp", slot: 0 } });
    // Scouting: the stronghold whole, its card, and the map told it has been looked at.
    expect(byClass("pip-raid-scout")[0].textContent).toContain(lands.strongholdName(7));
    expect(shown.scouted).toEqual([7]);
    expect(raidMark.isScouted(shown.base().strongholds, 7)).toBe(true);
    await press(button(/^Plan/));
    // The plan begins as the plan made without thinking, so Go can be pressed at once.
    expect(byClass("pip-raid-plan")).toHaveLength(1);
    const naive = squadMod.naiveSquad(rules.raidSetup(camp(), rules.planFor(camp(), "camp", DAY)));
    await press(button(/Go$/));
    expect(shown.started).toEqual([{ aim: { kind: "stronghold", target: { kind: "camp", slot: 0 } }, squad: naive }]);
    // The fight: the bar along the top (the bell, the three stars, the orders) and a chip for each group.
    expect(byClass("pip-raid-hud")).toHaveLength(1);
    expect(byClass("pip-raid-bell")).toHaveLength(1);
    expect(byClass("pip-raid-stars")[0].findAll((element) => element.tagName === "I")).toHaveLength(3);
    expect(byClass("pip-raid-orders-left")[0].textContent).toBe(String(4));
    expect(byClass("pip-raid-dock")[0].findAll((element) => element.tagName === "BUTTON" && classes(element).includes("pip-raid-group"))).toHaveLength(1);
    // Ended as it stands: the battle's result is taken in once, and the end card comes up.
    await press(button("End the raid"));
    await frames();
    expect(shown.finished).toHaveLength(1);
    const card = byClass("pip-raid-end-card")[0];
    expect(card).toBeTruthy();
    expect(card.textContent).toContain(String(shown.finished[0].end!.loot));
    expect(button(/Try again/)).toBeTruthy();
    await press(button(/Back to the map/));
    expect(shown.closed()).toBe(1);
  });

  it("marks what is wrong with a plan where it is wrong, and will not set out with it", async () => {
    await show(camp(), { kind: "stronghold", target: { kind: "rematch", slot: 2 } });
    await press(button(/^Plan/));
    const go = () => button(/Go$/)!;
    expect(go().hasAttribute("disabled")).toBe(false);
    // Over the hut's room.
    for (let k = 0; k < 4; k++) await press(button("One scouts more"));
    expect(all((element) => element.getAttribute("data-problem") === "room")).not.toHaveLength(0);
    expect(go().hasAttribute("disabled")).toBe(true);
    // Back within it, with one place spare; then a group with nobody in it.
    for (let k = 0; k < 5; k++) await press(button("One scouts fewer"));
    expect(all((element) => element.getAttribute("data-problem") === "room")).toHaveLength(0);
    expect(go().hasAttribute("disabled")).toBe(false);
    await press(button("Another group"));
    expect(all((element) => element.getAttribute("data-problem") === "empty")).not.toHaveLength(0);
    expect(go().hasAttribute("disabled")).toBe(true);
    // A scout in it, and it waits as the second wave: a plan that can go.
    await press(button("One scouts more"));
    await press(button(/Wait/));
    expect(all((element) => element.getAttribute("data-problem") !== null)).toHaveLength(0);
    expect(go().hasAttribute("disabled")).toBe(false);
    // Only one group waits: holding the first lets the second go.
    const chips = () => byClass("pip-raid-groups")[0].findAll((element) => classes(element).includes("pip-raid-group"));
    expect(chips().map((chip) => classes(chip).includes("is-held"))).toEqual([false, true]);
    await press(chips()[0]);
    await press(button(/Wait/));
    expect(chips().map((chip) => classes(chip).includes("is-held"))).toEqual([true, false]);
  });

  it("forecasts the plan once it has been still a moment, not at every change", async () => {
    const calls: Squad[] = [];
    // A run at a time: the step is asked until it says the forecast (the second time, here).
    let steps = 0;
    const forecast = vi.fn((setup: Parameters<typeof squadMod.forecastInSteps>[0]) => {
      calls.push(setup.squad!);
      let runs = 0;
      return () => {
        steps += 1;
        return ++runs < 2 ? null : ({ likely: 2, low: 1, high: 3, earned: [1, 1, 0], destroyed: 0.7 } as const);
      };
    });
    await show(camp(), { kind: "stronghold", target: { kind: "rematch", slot: 3 } }, { forecast: forecast as never });
    await press(button(/^Plan/));
    await React.act(async () => wait(FORECAST_WAIT_MS + 80));
    expect(forecast).toHaveBeenCalledTimes(1);
    // Five quick changes: one forecast, of the last of them, after the wait.
    for (let k = 0; k < 5; k++) await press(button(k % 2 ? "One scouts more" : "One scouts fewer"));
    expect(forecast).toHaveBeenCalledTimes(1);
    await React.act(async () => wait(FORECAST_WAIT_MS + 80));
    expect(forecast).toHaveBeenCalledTimes(2);
    expect(squadMod.roomOf(calls[1])).toBe(squadMod.roomOf(calls[0]) - 1);
    expect(all((element) => element.getAttribute("data-likely") === "2")).toHaveLength(1);
    expect(steps).toBe(4);
  });

  it("takes every order given on screen through `battle.order`, and plays the raid again exactly from what it kept", async () => {
    // A squad with a group held back, and the leaper (her move is aimed), some way into the fight.
    const vaulter = heroes.HEROES.findIndex((hero) => hero.move === "vault");
    const setup = {
      n: 4,
      king: false,
      capacity: 13,
      level: 4,
      kinds: ["sprout", "slinger", "mole"] as Array<"sprout" | "slinger" | "mole">,
      fast: false,
      hero: heroes.heroTraits(vaulter),
      squad: { groups: [squadMod.group({ sprout: 6, slinger: 2 }, 0, { hero: true }), squadMod.group({ sprout: 3 }, 1, { held: true })] }
    };
    const battle = new battleMod.Battle(setup);
    for (let k = 0; k < 60; k++) battle.step(battleMod.BATTLE_TICK);
    const order = vi.spyOn(battle, "order");
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    const view = { orient: "wide" as const, w: 240, h: 120, css: 3, backing: 3, crisp: true, left: 0, top: 0 };
    await React.act(async () =>
      root!.render(<RaidBattle battle={battle} art={art} view={view} roomW={720} roomH={420} region={1} season={0} name="Thorn Patch" still onDone={() => undefined} />)
    );
    // Rally: the group's chip, then the thing to send it at.
    await press(byClass("pip-raid-dock")[0].findAll((element) => classes(element).includes("pip-raid-group"))[0], "the first group's chip");
    const targets = byClass("pip-raid-target");
    expect(targets.length).toBeGreaterThan(0);
    const nest = targets.find((element) => /the nest/.test(element.getAttribute("aria-label") ?? ""));
    await press(nest, "the nest, as a rally's target");
    // The second wave.
    await press(button(/Release/));
    // The hero's move, by its name, aimed at a hoard.
    await press(button(new RegExp(heroes.HERO_MOVES.vault.name)));
    await press(byClass("pip-raid-target").find((element) => /a hoard/.test(element.getAttribute("aria-label") ?? "")), "a hoard, for the vault");
    expect(order.mock.calls.map(([given]) => given.kind)).toEqual(["rally", "release", "hero"]);
    expect(battle.given.map((given) => given.kind)).toEqual(["rally", "release", "hero"]);
    expect(battle.given[0]).toMatchObject({ kind: "rally", group: 0, target: battle.structures.find((entry) => entry.kind === "nest")!.id });
    expect(battle.given[2]).toMatchObject({ kind: "hero", target: expect.any(Number) });
    // The orders left, along the top, count down.
    expect(byClass("pip-raid-orders-left")[0].textContent).toBe(String(battle.ordersLeft));
    await React.act(async () => root!.unmount());
    root = null;
    // The fight to its end as it was going, and the same raid played again from its setup and the orders it kept.
    while (!battle.over) battle.step(battleMod.BATTLE_TICK);
    const again = squadMod.playOut({ ...setup, orders: battle.given });
    expect(again.result()).toEqual(battle.result());
    expect(again.events).toEqual(battle.events);
  });

  it("says on the end card what each star was for, and why the missed one was missed", async () => {
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    const end: RaidEnd = { won: true, stars: 2, loot: 40, name: "Tin Hill", banner: null, fled: false, bonus: 0, blade: null, home: null, earned: [true, true, false], feat: "bell", missed: ["bell"] };
    await React.act(async () => root!.render(<RaidEndCard end={end} onAgain={() => undefined} onMap={() => undefined} onLoot={() => undefined} />));
    const lines = byClass("pip-raid-lines")[0].findAll((element) => element.tagName === "LI");
    expect(lines.map((line) => line.textContent)).toEqual(["Took the nest", "Pulled down most of it", feats.MISSED.bell]);
    expect(classes(lines[2])).toContain("is-missed");
    // A raid lost at the nest: each missed star its own line, in order.
    const lost: RaidEnd = { ...end, won: false, stars: 0, earned: [false, false, false], feat: "crow", missed: ["nest", "most", "crowCalled"] };
    await React.act(async () => root!.render(<RaidEndCard end={lost} onAgain={null} againWhy="The scouts are resting" onMap={() => undefined} onLoot={() => undefined} />));
    expect(byClass("pip-raid-lines")[0].findAll((element) => element.tagName === "LI").map((line) => line.textContent)).toEqual([feats.MISSED.nest, feats.MISSED.most, feats.MISSED.crowCalled]);
    expect(button(/Try again/)!.hasAttribute("disabled")).toBe(true);
  });

  it("sends the plan made without thinking, and opens on its end card over the field as that raid left it", async () => {
    const base = camp();
    const plan = rules.planFor(base, "camp", DAY);
    const sent = rules.sendRaid(base, "camp", nowOf(base))!;
    expect(sent).toBeTruthy();
    // Send is the naive plan: everyone down the trail, nobody held back, no orders, played out.
    expect(sent.raid.setup.squad).toEqual(rules.naivePlanOf(base, plan));
    expect(sent.raid.setup.orders ?? []).toEqual([]);
    const played = squadMod.playOut(sent.raid.setup);
    expect(sent.end.stars).toBe(played.result().stars);
    // On screen: the end card at once, over the battle as it ended (its rubble), and nothing taken in twice.
    const target = sent.end.won ? { kind: "rematch" as const, slot: plan.n } : { kind: "camp" as const, slot: 0 };
    const shown = await show(sent.state, { kind: "stronghold", target }, { sent: { end: sent.end, raid: sent.raid } });
    await frames();
    expect(byClass("pip-raid-end-card")).toHaveLength(1);
    expect(byClass("pip-raid-scout")).toHaveLength(0);
    expect(shown.finished).toHaveLength(0);
    expect(shown.scouted).toEqual([]);
  });

  it("raids a friend's camp the same way, and has no Try again after", async () => {
    const base = camp();
    const friendCamp: import("../../../../pip/base/rules").SharedCamp = {
      levels: { burrow: 3, oak: 2, store: 3, fence: 1, tower: 3, hut: 2 },
      yard: [{ kind: "hive", level: 1 }],
      spots: { store: [200, 70], tower: [190, 84] },
      walls: [
        [170, 74],
        [170, 84]
      ],
      guards: [2, 0, 0, 0, 0, 0, 0]
    };
    const target = { handle: "wren", name: "Wren", camp: friendCamp, raidedToday: false } as unknown as import("../../../../services/socialService").RaidTarget;
    const shown = await show(base, { kind: "friend", target });
    expect(byClass("pip-raid-scout")[0].textContent).toContain("A friend's camp");
    // A friend's camp is not one of the map's strongholds: nothing is marked scouted.
    expect(shown.scouted).toEqual([]);
    await press(button(/^Plan/));
    await press(button(/Go$/));
    expect(shown.started[0].aim.kind).toBe("friend");
    await press(button("End the raid"));
    await frames();
    expect(shown.finished).toHaveLength(1);
    expect("friend" in shown.finished[0].raid).toBe(true);
    expect(button(/Try again/)).toBeUndefined();
  });

  it("fights the Magpie King, who wants two stars", async () => {
    const base = camp(10, { levels: { ...camp().levels, hut: 5 }, strongholds: { stars: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], scouted: [] } });
    const minutes = chapters.chapterStartsAt(10) + 60;
    const king = { ...base, minutes, chapterPaid: 10, chapterSeen: 10 };
    const shown = await show(rules.settle(king, { minutes, day: DAY, lit: false }), { kind: "stronghold", target: lands.KING_TARGET });
    expect(byClass("pip-raid-scout")[0].textContent).toContain("The Magpie King");
    expect(all((element) => element.getAttribute("aria-label") === "The stars: two to win")).toHaveLength(1);
    expect(shown.scouted).toEqual([]);
    await press(button(/^Plan/));
    await press(button(/Go$/));
    expect(shown.started).toHaveLength(1);
    expect(shown.started[0].aim).toEqual({ kind: "stronghold", target: lands.KING_TARGET });
    await press(button("End the raid"));
    await frames();
    expect(shown.finished[0].raid.plan.kind).toBe("king");
  });

  it("replays a stronghold just taken, and its best stars land on the map", async () => {
    const base = camp();
    const n = base.camps;
    // The raid won as it would be with the plan made without thinking, every star of it, for the end it brings.
    const begun = rules.startRaid(base, "camp", nowOf(base), false, 0, rules.naivePlanOf(base, rules.planFor(base, "camp", DAY)))!;
    const won = rules.finishRaid(begun.state, begun.raid, { stars: 2, destroyed: 0.8, hoards: 1, earned: [true, true, false], feat: "bell", missed: ["bell"] }, DAY);
    expect(won.state.camps).toBe(n + 1);
    expect(raidMark.starsOf(won.state.strongholds, n)).toBe(2);
    // On screen, after a stronghold falls in the flow, the end card stays with it and Try again is a replay of it.
    const twoStars: Result = { stars: 2, destroyed: 0.8, hoards: 1, earned: [true, true, false], feat: "bell", missed: ["bell"] };
    const shown = await show(base, { kind: "stronghold", target: { kind: "camp", slot: 0 } }, { result: twoStars });
    await press(button(/^Plan/));
    await press(button(/Go$/));
    await press(button("End the raid"));
    await frames();
    expect(shown.finished[0].end?.won).toBe(true);
    expect(shown.base().camps).toBe(n + 1);
    expect(byClass("pip-raid-end-card")[0].textContent).toContain("Taken!");
    await press(button(/Try again/));
    expect(byClass("pip-raid-plan")).toHaveLength(1);
    await press(button(/Go$/));
    expect(shown.started[1].aim).toEqual({ kind: "stronghold", target: { kind: "rematch", slot: n } });
    // A replay that betters the best fills the map's stars in; one that does worse leaves them.
    const replay = rules.startRaid(won.state, "rematch", nowOf(won.state), false, n, rules.naivePlanOf(won.state, rules.planFor(won.state, "rematch", DAY, n)))!;
    const better = rules.finishRaid(replay.state, replay.raid, { stars: 3, destroyed: 1, hoards: 1, earned: [true, true, true], feat: "bell", missed: [] }, DAY);
    expect(raidMark.starsOf(better.state.strongholds, n)).toBe(3);
    expect(better.state.camps).toBe(n + 1);
    const worse = rules.finishRaid(replay.state, replay.raid, { stars: 1, destroyed: 0.3, hoards: 0, earned: [true, false, false], feat: "bell", missed: ["most", "bell"] }, DAY);
    expect(raidMark.starsOf(worse.state.strongholds, n)).toBe(2);
    const map = lands.landsOf(better.state, { minutes: better.state.minutes, day: DAY });
    expect(map.nodes.find((node) => node.n === n)?.stars).toBe(3);
  });

  it("shows the fight's bar and orders in the camp's pixel chrome: chips in their groups' colours, a rally's pick plain to see", async () => {
    const { APPROACH_COLOURS } = await import("./raidPaint");
    const { KIND_ART } = await import("./raidWords");
    const setup = {
      n: 4,
      king: false,
      capacity: 13,
      level: 4,
      kinds: ["sprout", "slinger", "mole"] as Array<"sprout" | "slinger" | "mole">,
      fast: false,
      squad: { groups: [squadMod.group({ sprout: 5, slinger: 2 }, 0), squadMod.group({ sprout: 3, mole: 1 }, 1)] }
    };
    const battle = new battleMod.Battle(setup);
    for (let k = 0; k < 40; k++) battle.step(battleMod.BATTLE_TICK);
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    const view = { orient: "wide" as const, w: 240, h: 120, css: 3, backing: 3, crisp: true, left: 0, top: 0 };
    await React.act(async () =>
      root!.render(<RaidBattle battle={battle} art={art} view={view} roomW={720} roomH={420} region={1} season={0} name="Thorn Patch" still onDone={() => undefined} />)
    );
    // The bar: the bell, the stars and the orders, each a cell of one board; ending the raid is a pixel key.
    const hud = byClass("pip-raid-hud")[0];
    expect(hud.findAll((element) => classes(element).includes("pip-raid-hud-cell"))).toHaveLength(3);
    expect(classes(button("End the raid")!)).toContain("pip-raid-key");
    // A chip a group, in its path's colour, with its kinds' own pictures: the field's scouts.
    const chips = () => byClass("pip-raid-dock")[0].findAll((element) => element.tagName === "BUTTON" && classes(element).includes("pip-raid-group"));
    expect(chips()).toHaveLength(2);
    chips().forEach((chip, index) => {
      const via = battle.bands[index].via;
      expect(chip.style["--group"]).toBe(APPROACH_COLOURS[via % APPROACH_COLOURS.length]);
      const pictures = chip.findAll((element) => element.getAttribute("data-sprite") !== null).map((element) => element.getAttribute("data-sprite"));
      expect(pictures.length).toBeGreaterThan(0);
      for (const picture of pictures) expect(Object.values(KIND_ART).map((look) => `${look.name}:${look.variant}`)).toContain(picture);
    });
    // Tapped: the chip sinks in with a sight on it, the others step back, and what it can be sent at is ringed in its colour.
    expect(byClass("pip-raid-target")).toHaveLength(0);
    await press(chips()[1], "the second group's chip");
    const picked = chips()[1];
    expect(picked.getAttribute("aria-pressed")).toBe("true");
    expect(classes(picked)).toContain("is-chosen");
    expect(picked.findAll((element) => (element.getAttribute("class") ?? "").includes("pip-raid-sight"))).toHaveLength(1);
    expect(byClass("pip-raid-dock")[0].getAttribute("data-picking")).toBe("rally");
    const targets = byClass("pip-raid-target");
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(target.style["--group"]).toBe(picked.style["--group"]);
    // How it works, behind an (i) and nowhere else.
    expect(byClass("pip-raid-told")).toHaveLength(0);
    await press(button("How orders work"));
    expect(byClass("pip-raid-told")).toHaveLength(1);
  });

  it("plans with the field's own scouts for pictures, in a card of pixel paper with pixel keys, never round ones", async () => {
    const { KIND_ART } = await import("./raidWords");
    const { unitArt } = await import("./raidPaint");
    const shown = await show(camp(), { kind: "stronghold", target: { kind: "rematch", slot: 2 } });
    const roundKeys = () => all((element) => classes(element).includes("pip-base-round"));
    expect(roundKeys()).toHaveLength(0);
    expect(classes(button("Back to the map")!)).toContain("pip-raid-key");
    await press(button(/^Plan/));
    expect(roundKeys()).toHaveLength(0);
    // Each kind's tile shows the very picture the field draws that kind with.
    const tiles = byClass("pip-raid-kind");
    expect(tiles.length).toBeGreaterThanOrEqual(3);
    for (const tile of tiles) {
      const kind = tile.getAttribute("data-kind") as keyof typeof KIND_ART;
      const picture = tile.findAll((element) => element.getAttribute("data-sprite") !== null)[0];
      const look = unitArt(kind, 0);
      expect(picture.getAttribute("data-sprite")).toBe(`${look.name}:${look.variant}`);
      expect(picture.getAttribute("data-sprite")).toBe(`${KIND_ART[kind].name}:${KIND_ART[kind].variant}`);
    }
    // The group being planned: its tab and its page in its path's colour.
    const tab = byClass("pip-raid-groups")[0].findAll((element) => classes(element).includes("pip-raid-group"))[0];
    expect(tab.style["--group"]).toBeTruthy();
    expect(byClass("pip-raid-group-edit")[0].style["--group"]).toBe(tab.style["--group"]);
    await press(button(/Go$/));
    expect(roundKeys()).toHaveLength(0);
    await press(button("End the raid"));
    await frames();
    expect(byClass("pip-raid-end-card")).toHaveLength(1);
    expect(roundKeys()).toHaveLength(0);
    // The end card's stars are the map's pixel stars.
    expect(byClass("pip-raid-end-stars")[0].findAll((element) => element.tagName === "I")).toHaveLength(3);
    expect(shown.finished).toHaveLength(1);
  });

  it("has no raid board or old battle screen left, and nothing imports them", async () => {
    type Fs = { existsSync: (path: URL) => boolean; readdirSync: (path: URL, options: { withFileTypes: true }) => Array<{ name: string; isDirectory: () => boolean }>; readFileSync: (path: URL, encoding: "utf8") => string };
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
    expect(fs.existsSync(new URL("./BattleScreen.tsx", import.meta.url))).toBe(false);
    expect(fs.existsSync(new URL("./RaidBoard.tsx", import.meta.url))).toBe(false);
    const importers: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const at = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) walk(at);
        else if (/\.(ts|tsx|js)$/.test(entry.name) && /["'][^"']*\/(BattleScreen|RaidBoard)["']/.test(fs.readFileSync(at, "utf8"))) importers.push(at.pathname);
      }
    };
    walk(new URL("../../../../", import.meta.url));
    expect(importers).toEqual([]);
  }, 30_000);
});
