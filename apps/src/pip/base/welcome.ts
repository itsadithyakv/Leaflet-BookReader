/**
 * Pip's welcome to a new camp (1.5.5): what a reader who has not read yet
 * can do in the Hollow on the first visit.
 *
 * Given once a camp, and kept with it (`BaseState.welcome`), so it syncs:
 *
 * - Pip shakes the oak: `WELCOME_WINDFALL` acorns on it, taken in with the
 *   ordinary tap (`gather`), the oak's clock untouched.
 * - A basket by the door: `WELCOME_BASKET` acorns, opened when the larder
 *   has room for all of it (after the larder, in the guided session).
 * - Two helping paws: a build finished at once. A paw sets what the job
 *   still wants to nothing; it never adds a minute read.
 * - One parcel after the first reading (`FIRST_READ_MINUTES`), with
 *   `FIRST_READ_PARCEL` acorns in it (`settle`, `openParcel`).
 *
 * The session's walk through (Pip's guided first visit): start 20, the oak
 * shaken and the list's reward 50 of 60, the larder (a paw) 35 of 150, the
 * basket 115, the burrow's second level (the other paw) 15. Nothing is
 * lost to a full larder on the way.
 *
 * None of it is reading. Minutes, the trophies' reading (`claimed`), the
 * reading ledger and the leaderboards are never touched; acorns are the
 * camp's toy money and reach no server count.
 *
 * The gift goes by `given` alone, never by how far the session got: a
 * session skipped still leaves the basket (once), and one played again from
 * the (i) is a demonstration that gives nothing (`baseStore` keeps the
 * replay out of the camp).
 */
import {
  WELCOME_BASKET,
  WELCOME_PAWS,
  WELCOME_WINDFALL,
  basketOpens,
  jobOn,
  type BaseState,
  type Site
} from "./rules";
import { learnt } from "./tips";

export { WELCOMED, WELCOME_BASKET, WELCOME_PAWS, WELCOME_WINDFALL, FIRST_READ_MINUTES, FIRST_READ_PARCEL, basketOpens, basketWaits, freshWelcome, prowlersCome, windfallOf, type CampWelcome } from "./rules";

const noted = (state: BaseState, day: string, text: string) => [{ day, text }, ...state.events].slice(0, 8);

/** Gives the welcome, once a camp: the oak shaken, the basket by the door, the paws. Unchanged, the same object. */
export const giveWelcome = (state: BaseState, minutesRead: number): BaseState =>
  state.welcome.given
    ? state
    : {
        ...state,
        welcome: {
          ...state.welcome,
          given: true,
          paws: WELCOME_PAWS,
          windfall: WELCOME_WINDFALL,
          basketOpened: false,
          firstReadParcel: "waiting",
          prowlersAfterRead: true,
          from: Math.max(0, Math.floor(minutesRead))
        }
      };

/** Opens the basket: all of its acorns, once, when the larder has room for them; unchanged otherwise. */
export const openWelcomeBasket = (state: BaseState, day: string): BaseState =>
  basketOpens(state)
    ? { ...state, acorns: state.acorns + WELCOME_BASKET, welcome: { ...state.welcome, basketOpened: true }, events: noted(state, day, `Pip's welcome basket: ${WELCOME_BASKET} acorns.`) }
    : state;

/**
 * A helping paw: what is going up on a site is finished at once (`settle`
 * raises it). Unchanged, the same object, when no paw is left or nothing is
 * going up there. The job's start stays where it was and no minute is added
 * anywhere: the paw only says the job wants no more.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const pawFinish = (state: BaseState, site: Site, _minutesRead?: number, _mood?: number): BaseState => {
  if (state.welcome.paws <= 0) return state;
  // Since 1.5.8 a building stands as soon as it is paid for (`build`), so a paw has only ever a job kept from before
  // to finish; with nothing going up there it does nothing (it used to build first, which would now be a second level).
  const begun = state;
  const job = jobOn(begun, site);
  if (!job) return state;
  return {
    ...begun,
    jobs: begun.jobs.map((entry) => (entry === job ? { ...entry, needs: 0 } : entry)),
    welcome: { ...begun.welcome, paws: begun.welcome.paws - 1 }
  };
};

/** A camp the reader has done something with, or been welcomed to: one only ever looked at is not spoken of outside the Hollow. */
export const campBegun = (base: BaseState | null): base is BaseState =>
  Boolean(base && (base.welcome?.given || base.quest > 0 || base.stats.gathered > 0 || base.jobs.length > 0 || base.levels.store > 0));

/** Whether the guided first session is on: the welcome given, the session neither finished nor skipped. */
export const tutorialOn = (state: BaseState) => state.welcome.given && !state.welcome.tutorial.done;

/** Where the guided session has got to, kept so that it picks up there; nothing once it is over. */
export const setTutorialStep = (state: BaseState, step: number): BaseState => {
  const at = Math.max(0, Math.min(20, Math.floor(step)));
  return !tutorialOn(state) || state.welcome.tutorial.step === at ? state : { ...state, welcome: { ...state.welcome, tutorial: { ...state.welcome.tutorial, step: at } } };
};

/**
 * The guided session is over, finished or skipped, and never comes back by
 * itself. Skipped, the welcome is still given (once: the basket waits by
 * the door). Finished, the tips it stood in for are taught. The parcel and
 * the prowlers count the reading from here.
 */
export const finishTutorial = (state: BaseState, skipped: boolean, minutesRead: number): BaseState => {
  const given = giveWelcome(state, minutesRead);
  if (given.welcome.tutorial.done) return given;
  let next: BaseState = {
    ...given,
    welcome: { ...given.welcome, tutorial: { ...given.welcome.tutorial, done: true, skipped }, from: Math.max(0, Math.floor(minutesRead)) }
  };
  if (!skipped) for (const tip of ["oak", "build", "parcel"]) next = learnt(next, tip);
  return next;
};
