import { useEffect, type RefObject } from "react";
import { bindEdgeLight, edgeLightHandlers } from "./edgeLight";

/**
 * A PDF's or a comic's stage by finger: a swipe up or down from its left
 * strip sets the brightness, from its right the warmth (readers/edgeLight.ts).
 * Bound while `active` (a phone or a tablet, the pages drawn).
 */
export const useStageLightSwipes = (stageRef: RefObject<HTMLElement>, active: boolean) => {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !active) {
      return undefined;
    }
    const light = edgeLightHandlers({
      enabled: () => stage.isConnected,
      page: () => {
        const box = stage.getBoundingClientRect();
        return box.width > 0 ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
      },
      busy: () => {
        const picked = document.getSelection();
        return Boolean(picked && !picked.isCollapsed && picked.toString().trim());
      }
    });
    const off = bindEdgeLight(stage, light);
    return () => {
      light.cancel();
      off();
    };
  }, [active]);
};
