/**
 * The Reading Stones (1.5.11, "Your reading, made visible"): the long arc
 * after chapter 10, at the back of the meadow. A ring of twelve places: a
 * low stone for each of chapters 7 to 10, then a tall one for every volume
 * (fifteen hours each), carved with the hours. From the ninth volume the ring
 * goes round again: the stone in a place is the latest, mossed on the second
 * time round, gold-capped on the third, and lit from the fourth. The first
 * six volumes each bring a set Pip puts out by the stones.
 *
 * All of it from the minutes read: nothing is kept, and nothing to bring an
 * old camp onto.
 */
import { CHAPTERS_MOST, CHAPTER_HOURS, VOLUME_HOURS, VOLUME_SETS, chapterOf } from "./chapters";

/** The ring: its middle (where Pip in stone stands, the second set), and how many places it has. */
export const RING_AT: readonly [number, number] = [208, 70];
/**
 * The ring's twelve places (1.5.11, polished): two arcs seen from the front, each open in the middle, so that no
 * stone stands in front of another and Pip's statue is seen through the gap. Places 0 to 5 are the front arc (the
 * four chapter stones come first), 6 to 11 the back. Whole pixels; clear of the bud at the Reading Path's end.
 */
export const RING_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [182, 74],
  [191, 77],
  [200, 78],
  [216, 78],
  [225, 77],
  [234, 74],
  [182, 61],
  [191, 59],
  [199, 58],
  [217, 58],
  [225, 59],
  [234, 61]
];
export const RING_PLACES = 12;
/** The chapters with a low stone: the last four. */
export const LOW_FROM = CHAPTERS_MOST - 3;
/** Places 0 to 3 are the low stones; 4 to 11 go to the volumes, round and round. */
const TALL_PLACES = RING_PLACES - 4;
/** The sets the volumes bring, in turn; no more after the sixth. */
export const STONE_SETS = VOLUME_SETS;

export type Stone = {
  /** Its place in the ring, 0 to 11. */
  place: number;
  /** A chapter's low stone, or a volume's tall one. */
  tall: boolean;
  /** What is carved on it: the chapter's number, or the hours read when the volume came. */
  carved: number;
  /** The volume (the latest in its place), for a tall stone. */
  volume: number | null;
  /** How many times the ring has come round to its place: 2 mossed, 3 gold-capped, 4 on lit. */
  round: number;
  x: number;
  y: number;
};

/** Where a place of the ring is, on the picture: whole pixels. */
export const ringSpot = (place: number): [number, number] => {
  const [x, y] = RING_SPOTS[((Math.floor(place) % RING_PLACES) + RING_PLACES) % RING_PLACES];
  return [x, y];
};

/** The hours read when a volume came. */
export const volumeHours = (volume: number) => CHAPTER_HOURS[CHAPTERS_MOST - 1] + VOLUME_HOURS * volume;

/** The stones that stand for so many minutes read, by place; and the sets put out. */
export const stonesOf = (minutes: number): { stones: Stone[]; sets: number[]; volumes: number } => {
  const chapter = chapterOf(minutes);
  const stones: Stone[] = [];
  for (let at = LOW_FROM; at <= Math.min(CHAPTERS_MOST, chapter); at++) {
    const place = at - LOW_FROM;
    const [x, y] = ringSpot(place);
    stones.push({ place, tall: false, carved: at, volume: null, round: 1, x, y });
  }
  const volumes = Math.max(0, chapter - CHAPTERS_MOST);
  // The latest volume in each of the tall places: the ring goes round again from the ninth.
  for (let slot = 0; slot < Math.min(TALL_PLACES, volumes); slot++) {
    const rounds = Math.floor((volumes - 1 - slot) / TALL_PLACES) + 1;
    const volume = slot + 1 + (rounds - 1) * TALL_PLACES;
    const place = 4 + slot;
    const [x, y] = ringSpot(place);
    stones.push({ place, tall: true, carved: volumeHours(volume), volume, round: rounds, x, y });
  }
  const sets = Array.from({ length: Math.min(STONE_SETS.length, volumes) }, (_, index) => index + 1);
  return { stones, sets, volumes };
};

/** A stone, said when it is tapped: "Volume 3 · 90 h read", or "Chapter 8". */
export const stoneSays = (stone: Pick<Stone, "tall" | "carved" | "volume">): string => (stone.tall && stone.volume !== null ? `Volume ${stone.volume} · ${stone.carved} h read` : `Chapter ${stone.carved}`);
