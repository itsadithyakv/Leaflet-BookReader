import { useEffect, useMemo, useRef } from "react";
import { campNews, campWaits, seasonOf, settle } from "../../../../pip/base/rules";
import { getDateKey } from "../../../../services/habitService";
import { campBegun } from "../../../../pip/base/welcome";
import type { CampSummary } from "../../../../services/socialService";
import { minutesRead, nowFrom, useBaseStore } from "../../../../store/baseStore";
import { useHabitStore } from "../../../../store/habitStore";
import { gameArt } from "../gameArt";
import { GAME_H, GAME_W } from "../games";
import { lookOfSummary, paintCamp } from "./scene";

/**
 * The camp, where it shows outside the arcade: a line at the end of a
 * reading session, a dot on the way in when something is waiting, and a
 * friend's camp on their card.
 */

/** A camp the reader has done something with, or been welcomed to: one that was only ever looked at is not spoken for. */
const begun = campBegun;

/** The camp, read once for whoever asks from outside the arcade. */
const useCamp = () => {
  const base = useBaseStore((state) => state.base);
  useEffect(() => {
    if (!useBaseStore.getState().base) void useBaseStore.getState().open();
  }, []);
  return base;
};

/** At the end of a session: what the reading just did for the camp. Nothing for a reader who has no camp going. */
export const CampLine = () => {
  const base = useCamp();
  const snapshot = useHabitStore((state) => state.snapshot);
  // As the camp is now, with the reading just done (a parcel it sent is on the path), though nobody has opened it since.
  const news = useMemo(() => (begun(base) ? campNews(settle(base, nowFrom(snapshot)), minutesRead(snapshot)) : null), [base, snapshot]);
  if (!news) {
    return null;
  }
  return (
    <p className="mt-3 text-xs text-on-surface-variant">
      <span className="font-semibold text-on-surface">The Hollow.</span> {news}
    </p>
  );
};

/** Whether the camp has something waiting: for a dot on the arcade's button. */
export const useCampWaits = (): boolean => {
  const base = useCamp();
  const snapshot = useHabitStore((state) => state.snapshot);
  return useMemo(() => {
    if (!begun(base)) return false;
    const now = nowFrom(snapshot);
    return campWaits(settle(base, now), now);
  }, [base, snapshot]);
};

/**
 * A friend's camp, from their card: drawn from its levels and counts, laid
 * out as they have it (their buildings, fence and decorations where they put
 * them). A card with no layout, from an older app or server, is drawn as a
 * camp begins. Their trophies stand as stacks of books: which books is
 * theirs to know.
 */
export const CampVisit = ({ camp, name }: { camp: CampSummary; name: string }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const season = seasonOf(getDateKey());
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    paintCamp(ctx, gameArt("base", "", []), lookOfSummary(camp, season), 0);
  }, [camp, season]);
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <div className="pip-base-visit">
      <canvas ref={canvasRef} width={GAME_W} height={GAME_H} className="pip-sprite" style={{ width: "100%", maxWidth: GAME_W * 2, aspectRatio: `${GAME_W} / ${GAME_H}` }} role="img" aria-label={`${name}'s camp`} />
      <p className="text-xs tabular-nums text-on-surface-variant">
        {count(camp.camps, "stronghold", "strongholds")} · {count(camp.banners, "banner", "banners")} · {count(camp.trophies, "trophy", "trophies")}
      </p>
    </div>
  );
};
