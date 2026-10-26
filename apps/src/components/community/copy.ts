import type { FollowState, KudosAbout, PeopleSort, SuggestionReason } from "../../services/socialService";
import { at } from "./format";

/**
 * The community's words, in one place.
 *
 * The same thing used to go by several names ("kudos", "a leaf", "cheer"; a
 * week that ended "Sunday night", "at the end of this week" and "every
 * Monday"). Each idea now has one word, and every screen takes it from here.
 *
 * - **kudos**: the one-a-day nod between readers (drawn as a leaf icon)
 * - **follow** / **following** / **follows you**: following is one-way. The
 *   readers you follow are "Following" (the tab was "Friends" until 1.5.15);
 *   "friends" is kept for two readers who follow each other (a visit, a
 *   raid, a present).
 * - **duel**: most minutes by Sunday at midnight wins
 * - **streak**: days in a row, written "12 days"
 * - **the board**: this week's leaderboard; it resets Sunday at midnight
 */

export const WEEK_ENDS = "Sunday at midnight";

/**
 * Where a reader's own profile is: the "You" card at the top of the Board
 * tab of the Social page. It went by four names ("Social → You", "Board →
 * You", "Social → Community"); every sentence that sends a reader there
 * takes it from here.
 */
export const PROFILE_PLACE = "Social → Board → You";

/** Where readers are found and followed (1.5.15; it was "Find readers" on the Board). */
export const PEOPLE_PLACE = "Social → People";

export const COPY = {
  signIn: "Sign in under Settings → Account to join in.",
  goPublic: "Your profile is private. Share it to join in: the board lists readers whose profile is shared.",
  notConnected:
    "The community needs a Leaflet server, the only part of the app that has one. Add its address in Settings. Everything else, including backup, works without it.",
  comingSoon: "Weekly boards, following and shared shelves are on their way. Your reading is already being counted, so nothing you read now is lost.",
  /** Under a board that has rows, for a reader who is not on it. */
  onlySharers:
    "The board lists readers whose profile is shared. Yours is private, so you are not on it; a friend whose profile is private (as accounts made before Leaflet 1.2 are, until shared) is not either.",
  onlyYou: "Only you",
  onlyYouHint: "Your profile is private, so this row is shown to nobody else. It is drawn from the minutes on this device.",
  shareFromRow: "Share my profile",
  sharedToast: "Your profile is shared. You're on this week's board.",
  privateToast: "Your profile is private again. You're off the board.",
  pickHandleFirst: "Pick a handle first: it's how other readers find you.",
  handleHint: "Letters, numbers, - and _. It's how other readers find you.",
  /** Under the switch on the sign-up form: exactly what sharing shows. */
  shareAtSignUp:
    `Other readers can see your name, your @handle, your Pip, this week's reading minutes, your streak, how many books you've finished, your shelf (the titles of up to 12 books you read lately), the book you have open, and your level and badges, and you appear on the weekly board. You can switch this off at any time under ${PROFILE_PLACE}.`,
  privateAtSignUp: `Nobody else can see you, and you're not on the board. You can share your profile later under ${PROFILE_PLACE}.`,
  shareLater: `You can share it any time under ${PROFILE_PLACE}.`,
  boardFailed: "Couldn't load the board.",
  boardStale: "Couldn't refresh the board, so what's below may be out of date.",
  profileLoading: "Checking your profile…",
  profileFailed: "Couldn't load your profile, so it isn't known whether it is shared.",
  kudosRule: "One kudos per reader per day",
  /** Behind the (i) beside kudos. */
  kudosExplained: "A daily pat on the back. One a day per reader; it doesn't cost or buy anything.",
  followsYou: "Follows you",
  /** The People tab against a server from before 1.5.15: said once, quietly. */
  peopleLater: "More arrives with the next server update.",
  duelRule: `Most minutes by ${WEEK_ENDS} wins`,
  boardResets: `The board resets ${WEEK_ENDS}, your local time`
} as const;

export const streakText = (days: number) => `${days} ${days === 1 ? "day" : "days"}`;

export const kudosSentText = (handle: string) => `Kudos sent to ${at(handle)}.`;
/** What kudos were for, after "for": "finishing Dune", "your review of Dune", "your quote from Dune". */
export const kudosForText = (about: KudosAbout) =>
  about.kind === "review" ? `your review of ${about.title}` : about.kind === "quote" ? `your quote from ${about.title}` : `finishing ${about.title}`;
export const kudosReceivedText = (handle: string, about?: KudosAbout | null) =>
  about ? `${at(handle)} sent you kudos for ${kudosForText(about)}.` : `${at(handle)} sent you kudos.`;
export const followingText = (handle: string) => `Following ${at(handle)}.`;
export const duelOnText = (handle: string) => `Duel on. Good luck against ${at(handle)}!`;
export const duelDeclinedText = "Declined. No hard feelings.";
export const duelSentText = (handle: string) => `Challenge sent. ${at(handle)} can accept it from their inbox.`;

/** How two readers stand, for the small badge beside a handle: only that they follow you (the button says the rest). */
export const relationText = (_isFollowing: boolean, followsYou: boolean) => (followsYou ? COPY.followsYou : null);

/** The follow button's word for each state. */
export const followLabel = (state: FollowState) => (state === "following" ? "Following" : state === "requested" ? "Requested" : "Follow");

/** The orders the People tab lists every public reader in. */
export const SORT_LABELS: Record<PeopleSort, string> = { active: "Active this week", most: "Most read", new: "New" };

/** Who sees a profile, as its owner's own page says it. */
export const VISIBILITY_LABELS = { public: "Public", followers: "Followers only", private: "Private" } as const;

/** Why a reader is suggested, in a few words under their name. */
export const reasonText = (reason: SuggestionReason) => {
  if (reason.kind === "book") {
    return `Posted about ${reason.title}`;
  }
  if (reason.via) {
    return reason.count > 1 ? `Followed by ${at(reason.via.handle)} and ${reason.count - 1} more` : `Followed by ${at(reason.via.handle)}`;
  }
  return reason.count === 1 ? "Followed by a reader you follow" : `Followed by ${reason.count} readers you follow`;
};
