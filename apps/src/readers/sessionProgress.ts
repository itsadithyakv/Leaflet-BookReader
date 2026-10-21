/**
 * How far through a focus session the mug and the flower show, in steps of
 * half a percent. The reader polls the session every 1.2 s and, with the
 * exact share, every poll was a new value: the whole reader drew itself
 * again every 1.2 s, under Smart Read's glide and auto-scroll too. In half
 * percent steps it does so every 7.5 s of a 25-minute session, and the mug
 * (72 px) rises by a third of a pixel at a time, as before to the eye.
 */
export const PROGRESS_STEPS = 200;

export const shownProgress = (share: number) =>
  Number.isFinite(share) ? Math.min(1, Math.max(0, Math.floor(share * PROGRESS_STEPS + 1e-9) / PROGRESS_STEPS)) : 0;
