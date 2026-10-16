import { useEffect, useState } from "react";
import { useBaseStore } from "../../../store/baseStore";
import { accessories } from "../../../pip/shop";
import { priceOf } from "../../../pages/pip/common";
import { PipFace } from "../arcade/base/Sprite";
import { Coach } from "./Coach";
import { useCoachStore } from "./coachStore";
import { whole, type Rect } from "./geometry";
import { worldOf } from "./HollowCoach";
import { LINES, MORE, STEP, resolveStep, running } from "./steps";
import { welcome as api, useReplay, useWelcomeReady } from "./welcomeApi";

const LOOK_MS = 150;

/**
 * The hat Pip points out: the cheapest one for her head that the reader
 * does not have and can pay for now (a new reader has 50 seeds; hats are
 * from 25). Null when there is none.
 */
export const firstHat = (owns: (id: string) => boolean, seeds: number, price: (id: string) => number): string | null =>
  accessories()
    .filter((item: { slot: string; id: string }) => item.slot === "head" && !owns(item.id) && price(item.id) > 0 && price(item.id) <= seeds)
    .sort((a: { id: string }, b: { id: string }) => price(a.id) - price(b.id))[0]?.id ?? null;

const shown = (node: Element | null): node is HTMLElement => Boolean(node && node.getBoundingClientRect().width > 0);

type View = { bounds: Rect; hole: Rect | null; phase: "shop" | "tab" | "pick" | "buy" | "out"; float: boolean; avoid?: Rect[] };

/**
 * The tour's step inside the burrow: Pip asks for a present (the shop,
 * then a hat she can be bought with the seeds a new reader has), puts it
 * on, and asks to go back out and show it off. Mounted on Pip's page; shows
 * only while the tour is at that step and the reader is indoors.
 */
export const HouseCoach = ({
  place,
  skin,
  outfit,
  owns,
  seeds
}: {
  place: "hollow" | "home";
  skin: string;
  outfit: readonly string[];
  owns: (id: string) => boolean;
  seeds: number;
}) => {
  const base = useBaseStore((state) => state.base);
  const ready = useWelcomeReady();
  const demo = useReplay() !== null;
  const world = worldOf(base, ready, outfit, place);
  const saved = world.welcome?.tutorial.step ?? 0;
  const step = resolveStep(saved, world);
  const on = place === "home" && !demo && Boolean(base) && running(world) && step === STEP.hat;
  const [view, setView] = useState<View | null>(null);
  const [asking, setAsking] = useState(false);
  const hat = firstHat(owns, seeds, (id) => priceOf("accessory", id));

  // Indoors, the door step is done: the tour is at the present.
  useEffect(() => {
    if (place === "home" && Boolean(base) && running(world) && !demo && step !== saved && step <= STEP.hat) api.setStep(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, step, saved, demo]);
  useEffect(() => {
    if (!on) return;
    useCoachStore.getState().setStep(step);
    return () => useCoachStore.getState().setStep(null);
  }, [on, step]);

  useEffect(() => {
    if (!on) {
      setView(null);
      return;
    }
    const look = () => {
      const page = document.querySelector(".pip-house-page");
      if (!page) return;
      const bounds = whole(page.getBoundingClientRect());
      const box = (node: Element) => whole(node.getBoundingClientRect());
      let next: View;
      if (world.hatOn) {
        const out = document.querySelector('[data-walk="outside"]');
        next = { bounds, hole: shown(out) ? box(out) : null, phase: "out", float: false };
      } else if (document.querySelector(".pip-shop")) {
        // In the shop (a dialog over the page): the tour only points, and the shop works as ever.
        const viewport = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        const confirm = document.querySelector(".pip-confirm .pip-key-primary");
        const buy = Array.from(document.querySelectorAll(".pip-shop-detail .pip-key-primary")).find((node) => /^Buy/.test(node.textContent ?? ""));
        const card = hat ? document.querySelector(`.pip-shop-card[data-key="accessory:${hat}"]`) : null;
        const chosen = card?.getAttribute("aria-pressed") === "true";
        if (shown(confirm)) next = { bounds: viewport, hole: box(confirm), phase: "buy", float: true };
        else if (chosen && shown(buy ?? null)) {
          // On a phone the shop's side pane has its key below the fold: brought into view.
          (buy as HTMLElement).scrollIntoView({ block: "nearest" });
          next = { bounds: viewport, hole: box(buy as Element), phase: "buy", float: true };
        }
        else if (shown(card)) {
          card.scrollIntoView({ block: "nearest" });
          next = { bounds: viewport, hole: box(card), phase: "pick", float: true };
        } else {
          // Another of the shop's tabs: its wardrobe first.
          const tab = document.getElementById("pip-shop-tab-wardrobe");
          next = { bounds: viewport, hole: shown(tab) ? box(tab) : null, phase: "tab", float: true };
        }
      } else {
        const key = document.querySelector('[data-walk="shop"]');
        next = { bounds, hole: shown(key) ? box(key) : null, phase: "shop", float: false };
      }
      // Out of the way of the rail of keys: what it points at is one of them.
      if (!next.float) next.avoid = [".pip-rail"].map((selector) => document.querySelector(selector)).filter(shown).map(box);
      setView((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    look();
    const timer = window.setInterval(look, LOOK_MS);
    return () => window.clearInterval(timer);
  }, [on, world.hatOn, hat]);

  if (!on || !view) return null;

  const line = asking ? (world.welcome?.basketOpened ? MORE.skipLate : MORE.skip) : view.phase === "out" ? MORE.outside : view.phase === "pick" ? MORE.pickHat : view.phase === "buy" ? MORE.buyHat : LINES.hat;
  const finish = () => {
    setAsking(false);
    api.finish(true);
  };
  return (
    <Coach
      bounds={view.bounds}
      hole={view.hole}
      dim={!view.float}
      through
      float={view.float}
      face={<PipFace skin={skin} outfit={outfit} box={34} move={view.phase === "out" ? "cheer" : "idea"} />}
      line={line}
      avoid={view.avoid}
      keys={
        <span className="pip-coach-keys">
          {asking ? (
            <>
              <button type="button" className="pip-say-button pip-say-button-primary" onClick={() => setAsking(false)}>
                Stay
              </button>
              <button type="button" className="pip-say-button pip-say-button-quiet" onClick={finish}>
                Skip
              </button>
            </>
          ) : (
            <>
              {/* No hat she can be bought (seeds spent elsewhere): on without it. */}
              {!hat && !world.hatOn && (
                <button type="button" className="pip-say-button pip-say-button-primary" onClick={() => api.setStep(STEP.bridge)}>
                  Next
                </button>
              )}
              <button type="button" className="pip-coach-skip" title="Skip the tour" onClick={() => setAsking(true)}>
                Skip
              </button>
            </>
          )}
        </span>
      }
    />
  );
};

/** Whether the guided session is still to run (or running) for this camp: the house's own first walk waits for it. */
export const useTourRunning = () => {
  const base = useBaseStore((state) => state.base);
  const ready = useWelcomeReady();
  return Boolean(base) && running({ ready, welcome: worldOf(base, ready, [], "home").welcome });
};
