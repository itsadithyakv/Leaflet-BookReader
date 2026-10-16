import { useEffect, useRef, useState, type RefObject } from "react";
import { useBaseStore } from "../../../store/baseStore";
import { jobOn, type BaseState } from "../../../pip/base/rules";
import { accessories } from "../../../pip/shop";
import { basketSpot } from "../arcade/base/scene";
import { PipFace } from "../arcade/base/Sprite";
import { Coach, passThrough } from "./Coach";
import { useCoachStore } from "./coachStore";
import { useSayDock } from "./useSayDock";
import { doorBox, grow, overlap, sceneToScreen, siteBox, whole, type Rect, type SceneBox } from "./geometry";
import { LINES, MORE, REPLAY_LINES, STEP, advancesBy, effectsOf, nextDemo, resolveStep, running, stepId, type World } from "./steps";
import { welcome as api, useReplay, useWelcomeReady, welcomeOf } from "./welcomeApi";

/** Seconds Pip's friends hammer at a build before it stands (a helping paw): long enough to see who did it. */
const HAMMER_MS = 1800;
/** How long "look, more room!" stays up over the bigger clearing. */
const ROOMIER_MS = 2200;
/** How often the targets are looked for again: things move (a panel opens, the window turns). */
const LOOK_MS = 120;

const HEADS = new Set(accessories().filter((item: { slot: string }) => item.slot === "head").map((item: { id: string }) => item.id));
/** Pip has a hat on. */
export const wearsHat = (outfit: readonly string[]) => outfit.some((id) => HEADS.has(id));

/** The world as the steps see it, from the camp out here. */
export const worldOf = (base: BaseState | null, ready: boolean, outfit: readonly string[], place: World["place"]): World => ({
  ready,
  welcome: welcomeOf(base),
  gathered: base?.stats.gathered ?? 0,
  store: base?.levels.store ?? 0,
  burrow: base?.levels.burrow ?? 0,
  job: base && jobOn(base, "store") ? "store" : base && jobOn(base, "burrow") ? "burrow" : null,
  place,
  hatOn: wearsHat(outfit)
});

/** The welcome basket in the picture, as a tap finds it (`scene.ts` `basketAtPoint`). */
const basketBox = (base: BaseState): SceneBox => {
  const [x, y] = basketSpot(base);
  return { x: x - 8, y: y - 12, w: 16, h: 15 };
};

type View = { bounds: Rect; hole: Rect | null; avoid: Rect[]; open: Rect[]; disabled: boolean; onKey: boolean };
const same = (a: View | null, b: View | null) => JSON.stringify(a) === JSON.stringify(b);
const rectOf = (node: Element) => whole(node.getBoundingClientRect());
const shown = (node: Element | null): node is HTMLElement => Boolean(node && (node as HTMLElement).offsetParent !== null && node.getBoundingClientRect().width > 0);

/**
 * Pip's guided first session, out in the Hollow: hello, the oak, the
 * larder, the basket, the burrow to level 2, and in at its door; and once
 * back out (in a hat), the line that bridges to reading. Mounted with the
 * camp (HollowPlace). Shows nothing until the sync guard says the camp is
 * the reader's own, nothing once the tour is done, and nothing to a camp
 * from before it.
 */
export const HollowCoach = ({ rootRef, skin, outfit }: { rootRef: RefObject<HTMLElement | null>; skin: string; outfit: readonly string[] }) => {
  // Pip's everyday bubble, out of the way of what it talks about (useSayDock.ts).
  useSayDock(rootRef);
  const base = useBaseStore((state) => state.base);
  const ready = useWelcomeReady();
  const replay = useReplay();
  const demo = replay !== null;
  const oakTapped = useCoachStore((state) => state.oakTapped);
  const world = worldOf(base, ready, outfit, "hollow");
  const on = Boolean(base) && running(world, demo);
  const saved = world.welcome?.tutorial.step ?? 0;
  const step = replay ? replay.step : resolveStep(saved, world);
  const [view, setView] = useState<View | null>(null);
  const [asking, setAsking] = useState(false);
  /** Pip has set off for her door: the tour keeps out of the way of her walk. */
  const [leaving, setLeaving] = useState(false);
  const [roomier, setRoomier] = useState(false);
  const pawed = useRef<Set<string>>(new Set());
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  // Where the tour has got to is the camp's: a step passed (here, or some other way) is kept.
  useEffect(() => {
    if (on && !demo && step !== saved) api.setStep(step);
  }, [on, demo, step, saved]);

  // The door opens to a tap only once the tour has got to it; and the page knows the tour is on.
  useEffect(() => {
    useCoachStore.getState().setStep(on ? step : null);
  }, [on, step]);
  useEffect(() => () => useCoachStore.getState().setStep(null), []);
  useEffect(() => {
    const root = rootRef.current;
    root?.classList.toggle("is-coached", on && step !== STEP.bridge);
    return () => root?.classList.remove("is-coached");
  }, [on, step, rootRef]);

  // What the welcome is asked for: a helping paw on the larder and the burrow (after a moment of hammering). The gift is BaseScreen's.
  useEffect(() => {
    if (!on) return;
    const timers: number[] = [];
    for (const effect of effectsOf(step, world, demo)) {
      if (effect.kind === "paw" && !pawed.current.has(effect.target)) {
        pawed.current.add(effect.target);
        const target = effect.target;
        timers.push(window.setTimeout(() => api.paw(target), HAMMER_MS));
      }
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // The world is read as it stands when the step or the job changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, step, demo, world.job, world.welcome?.given]);

  // The oak tapped in its step: a moment to see the acorns fly, then on.
  useEffect(() => {
    if (!on || demo || step !== STEP.oak || !oakTapped) return;
    const timer = window.setTimeout(() => {
      useCoachStore.getState().tapOak(false);
      api.setStep(STEP.larder);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [on, demo, step, oakTapped]);

  // The burrow at level 2: the wood is cleared back, and Pip says so while it is seen.
  const burrowWas = useRef(world.burrow);
  useEffect(() => {
    if (on && !demo && burrowWas.current < 2 && world.burrow >= 2) {
      setRoomier(true);
      const timer = window.setTimeout(() => setRoomier(false), ROOMIER_MS);
      burrowWas.current = world.burrow;
      return () => window.clearTimeout(timer);
    }
    burrowWas.current = world.burrow;
  }, [on, demo, world.burrow]);

  // A new step starts with the clearing in view: whatever panel was open is put away. So does a build going up
  // with a paw (its friends at it are what is to be seen, and the panel covers it on a phone).
  useEffect(() => {
    if (!on) return;
    const close = rootRef.current?.querySelector<HTMLButtonElement>(".pip-base-side-close");
    if (close) passThrough(() => close.click());
  }, [on, step, rootRef, world.job]);

  // Where things are on the screen, looked for again and again: the picture is laid out afresh as the window changes.
  useEffect(() => {
    if (!on) {
      setView(null);
      return;
    }
    const look = () => {
      const root = rootRef.current;
      const live = useBaseStore.getState().base;
      const canvas = root?.querySelector<HTMLCanvasElement>("canvas[data-sky]");
      if (!root || !live || !canvas) return;
      const bounds = rectOf(root);
      const from = canvas.getBoundingClientRect();
      const sky = Number(canvas.dataset.sky ?? 0) || 0;
      const onScreen = (box: SceneBox) => whole(sceneToScreen(box, from, sky));
      const button = (site: string) => root.querySelector<HTMLButtonElement>(`[data-coach="build"][data-site="${site}"]`);
      const lead = root.querySelector(".pip-base-stats > :first-child");
      const open = lead ? [rectOf(lead)] : [];
      let hole: Rect | null = null;
      let avoid: Rect[] = [];
      let disabled = false;
      let onKey = false;
      const id = stepId(step);
      if (id === "hello") hole = onScreen(siteBox("burrow", live.spots.burrow));
      else if (id === "oak") hole = onScreen(grow(siteBox("oak", live.spots.oak), 2));
      else if (id === "larder" || id === "burrow") {
        const site = id === "larder" ? "store" : "burrow";
        const key = demo ? null : button(site);
        // Going up (a paw's friends at it): the building itself is what is looked at.
        if (!demo && jobOn(live, site)) hole = onScreen(siteBox(site, live.spots[site]));
        else if (shown(key)) {
          key.scrollIntoView({ block: "nearest" });
          hole = rectOf(key);
          disabled = key.disabled;
          onKey = true;
          // The card the key is on is read too: Pip says her line beside it, not over it.
          const card = key.closest(".pip-base-card");
          avoid = card ? [rectOf(card)] : [];
        } else {
          // A panel open on something else covers the clearing: its tile for the site is the way to it.
          const tile = demo ? null : root.querySelector(`.pip-base-side .pip-base-tile[data-site="${site}"]`);
          hole = shown(tile) ? rectOf(tile) : onScreen(grow(siteBox(site, live.spots[site]), 2));
        }
      } else if (id === "basket") hole = onScreen(basketBox(live));
      else if (id === "door" || id === "hat") hole = onScreen(grow(doorBox(live.spots.burrow), 1));
      else if (id === "bridge") {
        const goal = root.querySelector("[data-welcome='goal']");
        hole = shown(goal) ? rectOf(goal) : null;
      }
      // The row of chips and keys along the top is kept clear too (on a phone it is most of what is above the clearing).
      const head = [".pip-base-stats", ".pip-base-head-right", ".pip-base-dock"].map((sel) => root.querySelector(sel)).filter(shown).map(rectOf);
      const next: View = { bounds, hole, avoid: [...avoid, ...head.filter((rect) => !hole || overlap(rect, hole) === 0)], open, disabled, onKey };
      setView((was) => (same(was, next) ? was : next));
    };
    look();
    const timer = window.setInterval(look, LOOK_MS);
    return () => window.clearInterval(timer);
  }, [on, step, demo, rootRef]);

  // Going in at the door: the tour stands aside for Pip's walk (and comes back if she did not go).
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), 3500);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (!on || !view || !base || leaving) return null;

  const id = stepId(step);
  const finish = (skipped: boolean) => {
    setAsking(false);
    // (Finished, the tips the tour stood in for are taught: `welcome.ts`. A replay just ends.)
    api.finish(skipped);
  };
  const next = () => {
    if (demo) {
      const after = nextDemo(step);
      if (after === null) finish(false);
      else api.setStep(after);
      return;
    }
    if (step === STEP.bridge) finish(false);
    else api.setStep(step + 1);
  };

  const hammering = !demo && ((id === "larder" && world.job === "store") || (id === "burrow" && world.job === "burrow"));
  const celebrating = !demo && roomier;
  const byNext = advancesBy(step, demo) === "next";
  const line = asking
    ? world.welcome?.basketOpened
      ? MORE.skipLate
      : MORE.skip
    : celebrating
      ? MORE.roomier
      : hammering
        ? MORE.hammer
        : view.onKey
          ? id === "larder"
            ? MORE.build
            : MORE.raise
          : demo
            ? REPLAY_LINES[id]
            : id === "hat"
              ? LINES.door
              : LINES[id];
  const face = <PipFace skin={skin} outfit={outfit} box={coarse ? 30 : 40} move={celebrating || hammering ? "cheer" : step === STEP.hello ? "idle" : "idea"} />;
  const keys = asking ? (
    <span className="pip-coach-keys">
      <button type="button" className="pip-say-button pip-say-button-primary" onClick={() => setAsking(false)}>
        Stay
      </button>
      <button type="button" className="pip-say-button pip-say-button-quiet" onClick={() => finish(true)}>
        Skip
      </button>
    </span>
  ) : (
    <span className="pip-coach-keys">
      {(byNext || view.disabled) && (
        <button type="button" className="pip-say-button pip-say-button-primary" onClick={next}>
          {step === STEP.bridge ? "Got it" : demo && nextDemo(step) === null ? "Done" : "Next"}
        </button>
      )}
      {step !== STEP.bridge && (
        <button type="button" className="pip-coach-skip" title={demo ? "Stop the tour" : "Skip the tour"} onClick={() => (demo ? finish(false) : setAsking(true))}>
          Skip
        </button>
      )}
    </span>
  );

  // A pause in the tour (hammering, the bigger clearing): nothing lit, nothing to tap, the picture seen whole.
  const still = hammering || celebrating;
  const bridge = id === "bridge";
  return (
    <Coach
      bounds={view.bounds}
      hole={view.hole}
      dim={!still && !bridge}
      ring={!still}
      paw={!still && !bridge}
      through={!demo && !byNext && !still}
      open={view.open}
      float={bridge}
      onElsewhere={step === STEP.hello && !asking ? next : undefined}
      onHole={() => {
        if (id === "oak") useCoachStore.getState().tapOak(true);
        else if (id === "door" || id === "hat") setLeaving(true);
      }}
      face={face}
      line={line}
      keys={keys}
      avoid={view.avoid}
    />
  );
};
