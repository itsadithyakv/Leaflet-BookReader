import { useEffect, useMemo, useRef } from "react";
import { Flag, Swords, Trophy } from "lucide-react";
import { campNews, campWaits, seasonOf, settle } from "../../../../pip/base/rules";
import { getDateKey } from "../../../../services/habitService";
import { campBegun } from "../../../../pip/base/welcome";
import type { CampSummary } from "../../../../services/socialService";
import { minutesRead, nowFrom, useBaseStore } from "../../../../store/baseStore";
import { useHabitStore } from "../../../../store/habitStore";
import { gameArt } from "../gameArt";
import { drawPostcardPicture, POSTCARD_PICTURE_H, POSTCARD_W } from "./postcard";
import { lookOfSummary } from "./scene";

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

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A reader's camp, as the banner across the top of their page: the picture
 * of the Hollow's postcard (`postcard.ts`), sky and all, with Pip out on the
 * grass, drawn once and standing still. It is drawn from the camp's levels
 * and counts, laid out as they have it (their buildings, fence and
 * decorations where they put them); a camp with no layout, from an older app
 * or server, is drawn as a camp begins. Their trophies stand as stacks of
 * books: which books is theirs to know. What the camp has won sits in a
 * corner, as figures with a name on hover.
 */
export const CampBanner = ({ camp, name }: { camp: CampSummary; name: string }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const season = seasonOf(getDateKey());
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawPostcardPicture(ctx, gameArt("base", "", []), lookOfSummary(camp, season));
  }, [camp, season]);
  const won = [
    { Icon: Swords, n: camp.camps, label: count(camp.camps, "stronghold", "strongholds") },
    { Icon: Flag, n: camp.banners, label: count(camp.banners, "banner", "banners") },
    { Icon: Trophy, n: camp.trophies, label: count(camp.trophies, "trophy", "trophies") }
  ].filter((figure) => figure.n > 0);
  return (
    <div className="pip-camp-banner">
      <canvas ref={canvasRef} width={POSTCARD_W} height={POSTCARD_PICTURE_H} role="img" aria-label={`${name}'s camp${won.length ? `: ${won.map((figure) => figure.label).join(", ")}` : ""}`} />
      {won.length > 0 && (
        <p className="pip-camp-banner-won" aria-hidden>
          {won.map(({ Icon, n, label }) => (
            <span key={label} title={label}>
              <Icon size={11} /> {n}
            </span>
          ))}
        </p>
      )}
    </div>
  );
};
