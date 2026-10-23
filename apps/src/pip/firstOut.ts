/** How long after the app's start Pip first comes out, unless she has been out already (PipWorld). */
export const FIRST_OUT_MS = 1400;

/**
 * The wait before her first coming out. Pip is put in once the library is on
 * screen (App.tsx), a moment after the app started; the wait is what is left of
 * FIRST_OUT_MS since `startedAt`, so she comes out when she always did. Without
 * a start (or for any later coming out) it is all of it.
 */
export const firstOutDelay = (startedAt: number | undefined, now: number) =>
  startedAt === undefined ? FIRST_OUT_MS : Math.max(0, FIRST_OUT_MS - Math.max(0, now - startedAt));
