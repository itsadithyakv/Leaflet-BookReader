import { useLayoutEffect, useState, type RefObject } from "react";
import type { Rect } from "../../components/pip/layout";

/** Kept under the tool rail: the gap above it and what is left of the page's bottom margin, so nothing scrolls. */
const BELOW_RAIL = 26;

/** Where an element is inside `ancestor`, by layout (a zoom still animating does not move it). */
const offsetWithin = (element: HTMLElement, ancestor: HTMLElement): Rect => {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = element;
  while (node && node !== ancestor) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { left, top, width: element.offsetWidth, height: element.offsetHeight };
};

type RoomFrameOptions = {
  /** The house's body, which holds the room. */
  bodyRef: RefObject<HTMLDivElement>;
  railRef: RefObject<HTMLElement>;
  drawerRef: RefObject<HTMLElement>;
  /** The sheet on screen, if any: a new one is measured afresh. */
  sheetKey: string | null;
  decorating: boolean;
};

/**
 * The room's frame on the page: where the room sits in the house's body (for
 * the lift beside it and the HUD lined up with it), and the room kept free
 * under the scene for the rail and a sheet at the bottom of a narrow window.
 */
export const useRoomFrame = ({ bodyRef, railRef, drawerRef, sheetKey, decorating }: RoomFrameOptions) => {
  // The room's box in the house's body, for the lift beside it and the HUD lined up with it.
  const [roomBox, setRoomBox] = useState<Rect | null>(null);
  const [reserve, setReserve] = useState(120);

  // Where the room is, for the lift beside it and the HUD lined up with it.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      const room = body.querySelector<HTMLElement>(".pip-house-room");
      if (!room) return;
      const next = offsetWithin(room, body);
      setRoomBox((current) =>
        current && current.left === next.left && current.top === next.top && current.width === next.width && current.height === next.height ? current : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    body.querySelectorAll(".pip-house-stage, .pip-house-room").forEach((element) => observer.observe(element));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Room kept under the scene: the rail, and a sheet at the bottom of a narrow
  // window, so the room shrinks to sit above them rather than under them.
  useLayoutEffect(() => {
    const measure = () => {
      const rail = railRef.current?.offsetHeight ?? 72;
      const panel = drawerRef.current;
      const low = panel && getComputedStyle(panel).position === "fixed" ? panel.offsetHeight + 12 : 0;
      const next = rail + BELOW_RAIL + low;
      setReserve((current) => (Math.abs(current - next) < 2 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (railRef.current) observer.observe(railRef.current);
    if (drawerRef.current) observer.observe(drawerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [sheetKey, decorating]);

  return { roomBox, reserve };
};
