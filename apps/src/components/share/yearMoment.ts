/**
 * When "Your Year in Pages" is in season: from 24 December to 7 January, by
 * the device's own calendar, so a reader away over the holidays still finds
 * it. In season the Library shows a key to it and Pip says so once; out of
 * it, every year stays in Social, Stats.
 *
 * Small and pure: the Library reads it at start, and the story itself (its
 * own chunk) is loaded only when it is opened.
 */

/** The year in season on `now`, or null: December's from the 24th, last year's until 7 January. */
export const yearInSeason = (now: Date): number | null => {
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 11 && day >= 24) {
    return now.getFullYear();
  }
  if (month === 0 && day <= 7) {
    return now.getFullYear() - 1;
  }
  return null;
};

/** Where the year Pip last told of is kept: she says it once a year. */
export const PIP_TOLD_KEY = "leaflet.year.told";

/** Whether Pip still has `year` to tell of, given what is kept. */
export const pipHasToTell = (year: number, kept: string | null) => kept !== String(year);

/** What she says: lower case, short enough for her bubble. */
export const pipYearLine = (year: number) => `your ${year} in pages is ready. it's up top.`;

/** Whether the days hold any reading in `year`: no key for a year with nothing in it. */
export const readIn = (days: ReadonlyArray<{ dateKey: string; minutes: number }>, year: number) => {
  const prefix = `${year}-`;
  return days.some((day) => day.minutes > 0 && day.dateKey.startsWith(prefix));
};
