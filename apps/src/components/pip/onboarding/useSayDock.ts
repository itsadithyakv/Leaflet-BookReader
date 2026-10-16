import { useEffect, type RefObject } from "react";
import { campNow, useBaseStore } from "../../../store/baseStore";
import { PLACED, nextStep, type Placed } from "../../../pip/base/rules";
import { overlap, pad, placeBubble, sceneToScreen, siteBox, whole } from "./geometry";

/** How often the bubble is looked at again: the picture is laid out afresh as the window turns and the panel opens. */
const LOOK_MS = 300;

const shown = (node: Element | null): node is HTMLElement => Boolean(node && node.getBoundingClientRect().width > 0);
const rectOf = (node: Element) => whole(node.getBoundingClientRect());

/**
 * Pip's everyday bubble in the Hollow (her tip, the one next thing, the
 * parcels) never covers what it talks about. Where it would (a phone on its
 * side, where it sat over the oak it asked to be tapped), it is lifted out
 * of the row of chips and docked beside the thing instead, clear of the
 * chips along the top, the keys in the corner and the row of keys at the
 * foot (`placeBubble`, as the guided session's bubble is placed). Where it
 * covers nothing, it is left where the page puts it.
 *
 * Not while the guided session is on: then the session's bubble is the one
 * voice, and Pip's own waits (onboarding.css).
 */
export const useSayDock = (rootRef: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    let docked: HTMLElement | null = null;
    const undock = () => {
      if (!docked) return;
      docked.style.removeProperty("position");
      docked.style.removeProperty("left");
      docked.style.removeProperty("top");
      docked.style.removeProperty("z-index");
      docked.style.removeProperty("max-width");
      delete docked.dataset.docked;
      docked = null;
    };
    const look = () => {
      const root = rootRef.current;
      const base = useBaseStore.getState().base;
      const say = root?.querySelector<HTMLElement>(".pip-camp-say") ?? null;
      const canvas = root?.querySelector<HTMLCanvasElement>("canvas[data-sky]");
      if (!root || !base || !say || !canvas || root.classList.contains("is-coached") || canvas.dataset.area === "meadow") {
        undock();
        return;
      }
      // What it talks about: the place of the one next thing, where that is a building in the clearing.
      const at = nextStep(base, campNow().minutes).at;
      const site = (PLACED as readonly string[]).includes(at) ? (at as Placed) : null;
      if (!site) {
        undock();
        return;
      }
      const from = canvas.getBoundingClientRect();
      const target = whole(sceneToScreen(siteBox(site, base.spots[site]), from, Number(canvas.dataset.sky ?? 0) || 0));
      if (docked !== say) {
        undock();
        // Where the page puts it covers nothing: left there.
        if (!shown(say) || overlap(rectOf(say), pad(target, 4)) === 0) return;
      }
      const avoid = [".pip-base-stats", ".pip-base-head-right", ".pip-base-dock", ".pip-base-side"]
        .map((selector) => root.querySelector(selector))
        .filter(shown)
        .map(rectOf);
      // And over as little of the camp itself as can be: every building in the picture.
      const sky = Number(canvas.dataset.sky ?? 0) || 0;
      for (const other of PLACED) if (other !== site) avoid.push(whole(sceneToScreen(siteBox(other, base.spots[other]), from, sky)));
      const box = rectOf(root);
      // Under the chips along the top (and the phone's own bar over them).
      const chips = avoid[0];
      const top = Math.max(box.top, chips ? chips.top + chips.height + 6 : box.top);
      const bounds = pad({ left: box.left, top, width: box.width, height: box.top + box.height - top }, -6);
      if (bounds.height <= 0 || bounds.width <= 0) return;
      const size = { width: say.offsetWidth, height: say.offsetHeight };
      const place = placeBubble(pad(target, 2), size, bounds, avoid, 10);
      say.style.position = "fixed";
      say.style.left = `${place.left}px`;
      say.style.top = `${place.top}px`;
      say.style.zIndex = "5";
      say.style.maxWidth = `${Math.min(430, Math.round(bounds.width * 0.6))}px`;
      say.dataset.docked = place.side;
      docked = say;
    };
    look();
    const timer = window.setInterval(look, LOOK_MS);
    return () => {
      window.clearInterval(timer);
      undock();
    };
  }, [rootRef]);
};

