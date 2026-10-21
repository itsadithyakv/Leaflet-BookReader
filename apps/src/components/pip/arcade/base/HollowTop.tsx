import type { MutableRefObject, ReactNode, Ref } from "react";
import { ChevronRight, Info, Package } from "lucide-react";
import { Sprite } from "./Sprite";
import { AcornCount, AcornTrails, type AcornCue, type AcornTrailsHandle } from "./collect";
import { fillOf, hoursSaid, hoursText, percentOf } from "./chapterWords";
import { HollowMenu, type HollowNav } from "./HollowMenu";

/** What the chapter bar shows: the chapter, how far through it the reading is, and the one next thing. */
export type ChapterChip = {
  /** The chapter the camp is on (1 up; past the tenth, the volumes go on counting). */
  n: number;
  /** Past the tenth chapter, the volume ("Vol 3"); null before. */
  volume?: number | null;
  /** Minutes read in all, and the minutes read at which the next chapter comes. */
  read: number;
  to: number;
  /** How far through this chapter, 0 to 1. */
  part: number;
  /** The next unfinished goal, in a word or two ("Fence"), or what the next chapter brings ("Read 2 h 10 m: Chapter 6 brings guardians"). */
  next: string;
  /** Whether `next` is a goal (it reads "Next: …") or the reading to the next chapter. */
  goal: boolean;
};

type HollowTopProps = {
  chapter: ChapterChip | null;
  /** The chapter bar is not shown (Pip's guided first visit, until its last step). */
  chapterHidden?: boolean;
  onChapter: () => void;
  chapterOpen: boolean;
  acorns: number;
  acornCue: MutableRefObject<AcornCue>;
  acornChipRef: Ref<HTMLButtonElement>;
  trailsRef: Ref<AcornTrailsHandle>;
  /** What the camp was just paid, for a moment over the count. */
  gained: { acorns: number; at: number } | null;
  onAcorns: () => void;
  parcels: number;
  /** A tap on the parcels opens them all. */
  onParcels: () => void;
  guideOpen: boolean;
  onGuide: () => void;
  /** The ☰'s keys. */
  sound: boolean;
  onSound: (on: boolean) => void;
  onPostcard: (() => void) | null;
  onArcade: (() => void) | null;
  onHouse: (() => void) | null;
  nav?: HollowNav;
  /** (1.5.11) Tonight's chip: who is coming down the trail, at dusk and while the night is on. */
  night?: ReactNode;
  /** Under the bar: a chip's card, and what Pip has to say. */
  children?: ReactNode;
};

/**
 * The Hollow's top bar (1.5.10): ☰ · the chapter bar · 🌰 · the parcels (when any) · (i). Four things and the
 * menu, so it never wraps onto the picture, down to a phone of 740 × 360 on its side. Everything that was on it
 * besides (sound, the postcard, the arcade, Pip's house) is in the menu; the level and Pip's list are the
 * chapter bar; what acorns and chapters are is in the guide behind the (i), and behind a tap on the bar or the count.
 */
export const HollowTop = ({
  chapter,
  chapterHidden = false,
  onChapter,
  chapterOpen,
  acorns,
  acornCue,
  acornChipRef,
  trailsRef,
  gained,
  onAcorns,
  parcels,
  onParcels,
  guideOpen,
  onGuide,
  sound,
  onSound,
  onPostcard,
  onArcade,
  onHouse,
  nav,
  night,
  children
}: HollowTopProps) => (
  <div className="pip-base-head">
    <div className="pip-base-head-left">
      <p className="pip-base-stats pip-hollow-top">
        <HollowMenu sound={sound} onSound={onSound} onPostcard={onPostcard} onArcade={onArcade} onHouse={onHouse} nav={nav} />
        {chapter && !chapterHidden && <ChapterBar chapter={chapter} open={chapterOpen} onOpen={onChapter} />}
        {/* The Hollow's one money: plain, a count and no pill (the berry pill is for what waits). */}
        <button
          type="button"
          ref={acornChipRef}
          className="pip-base-chip pip-hud-chip pip-hollow-acorns"
          data-hud="acorns"
          aria-label={`${acorns} acorns. What acorns are for`}
          onClick={onAcorns}
        >
          <Sprite name="acorn" box={16} />
          {/* The figure goes up as acorns land on it, and down as they are spent (collect.tsx). */}
          <AcornCount value={acorns} cue={acornCue} />
          {gained && gained.acorns > 0 && (
            <span key={gained.at} className="pip-base-gain" aria-hidden="true">
              +{gained.acorns}
            </span>
          )}
        </button>
        <AcornTrails ref={trailsRef} />
        {night}
        {parcels > 0 && (
          <button
            type="button"
            className="pip-base-chip pip-hud-chip pip-hollow-parcels is-lit"
            data-hud="parcels"
            aria-label={`${parcels} ${parcels === 1 ? "parcel" : "parcels"} from your reading. Open all`}
            title="Parcels from your reading: open all"
            onClick={onParcels}
          >
            <Package size={13} aria-hidden /> <strong>{parcels}</strong>
            <span className="pip-hollow-parcels-word" aria-hidden="true">
              Open all
            </span>
          </button>
        )}
      </p>
      {children}
    </div>
    <span className="pip-base-head-right">
      <button
        type="button"
        className="pip-base-round pip-hollow-guide-key"
        aria-expanded={guideOpen}
        aria-label="The guide: how the Hollow works, and what happened"
        title="How the Hollow works, and what happened"
        onClick={onGuide}
      >
        <Info size={16} aria-hidden />
      </button>
    </span>
  </div>
);

/** The chapter bar's track, in CSS pixels. */
const BAR_W = 44;

/** "Ch 4 [▰▰▰▱▱] 6 h 20 m / 10 h · Next: Lay 3 pieces of fence ›": one chip, and a tap on it is the chapter's card. */
const ChapterBar = ({ chapter, open, onOpen }: { chapter: ChapterChip; open: boolean; onOpen: () => void }) => {
  const fill = fillOf(chapter.part, BAR_W);
  const where = chapter.volume ? `Volume ${chapter.volume}` : `Chapter ${chapter.n}`;
  const after = chapter.volume ? `volume ${chapter.volume + 1}` : `chapter ${chapter.n + 1}`;
  return (
    <button
      type="button"
      className="pip-base-chip pip-hud-chip pip-chapter-bar"
      data-hud="chapter"
      data-welcome="goal"
      aria-expanded={open}
      aria-label={`${where}: ${hoursSaid(chapter.read)} read of ${hoursSaid(chapter.to)}, ${percentOf(chapter.part)}% of the way to ${after}. ${chapter.goal ? `Next: ${chapter.next}` : chapter.next}. The chapter's card`}
      onClick={onOpen}
    >
      <span className="pip-chapter-bar-n" aria-hidden="true">
        {chapter.volume ? `Vol ${chapter.volume}` : `Ch ${chapter.n}`}
      </span>
      <span className="pip-chapter-meter" aria-hidden="true" style={{ width: BAR_W }}>
        <span className="pip-chapter-meter-fill" style={{ width: fill }} />
      </span>
      <span className="pip-chapter-bar-hours" aria-hidden="true">
        {hoursText(chapter.read)}
        <span className="pip-chapter-bar-of"> / {hoursText(chapter.to)}</span>
      </span>
      <span className="pip-chapter-bar-next" aria-hidden="true">
        {chapter.goal ? (
          <>
            <span className="pip-chapter-bar-next-word">Next: </span>
            <strong>{chapter.next}</strong>
          </>
        ) : (
          chapter.next
        )}
      </span>
      <ChevronRight size={13} aria-hidden className="pip-chapter-bar-go" />
    </button>
  );
};
