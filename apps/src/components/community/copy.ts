import { at } from "./format";

/**
 * The community's words, in one place.
 *
 * The same thing used to go by several names ("kudos", "a leaf", "cheer"; a
 * week that ended "Sunday night", "at the end of this week" and "every
 * Monday"). Each idea now has one word, and every screen takes it from here.
 *
 * - **kudos**: the one-a-day nod between readers (drawn as a leaf icon)
 * - **follow** / **follows you** / **you follow each other**
 * - **duel**: most minutes by Sunday at midnight wins
 * - **streak**: days in a row, written "12 days"
 * - **the board**: this week's leaderboard; it resets Sunday at midnight
 */

export const WEEK_ENDS = "Sunday at midnight";

export const COPY = {
  signIn: "Sign in under Settings → Account to join in.",
  signInTitle: "Join the community",
  signInBody:
    "Look around as much as you like. To appear on the board, follow readers, send kudos and duel, sign in or create an account under Settings → Account. A new account's profile is shared from the start, and you can make it private whenever you like.",
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
    "Other readers can see your name, your @handle, your Pip, this week's reading minutes, your streak, how many books you've finished and your shelf (the titles of up to 12 books from your recent reading sessions), and you appear on the weekly board. You can switch this off at any time under Social → You.",
  privateAtSignUp: "Nobody else can see you, and you're not on the board. You can share your profile later under Social → You.",
  shareLater: "You can share it any time under Social → You.",
  boardFailed: "Couldn't load the board.",
  boardStale: "Couldn't refresh the board, so what's below may be out of date.",
  profileLoading: "Checking your profile…",
  profileFailed: "Couldn't load your profile, so it isn't known whether it is shared.",
  kudosRule: "One kudos per reader per day",
  duelRule: `Most minutes by ${WEEK_ENDS} wins`,
  boardResets: `The board resets ${WEEK_ENDS}, your local time`
} as const;

export const streakText = (days: number) => `${days} ${days === 1 ? "day" : "days"}`;

export const kudosSentText = (handle: string) => `Kudos sent to ${at(handle)}.`;
export const kudosReceivedText = (handle: string) => `${at(handle)} sent you kudos.`;
export const followingText = (handle: string) => `Following ${at(handle)}.`;
export const duelOnText = (handle: string) => `Duel on. Good luck against ${at(handle)}!`;
export const duelDeclinedText = "Declined. No hard feelings.";
export const duelSentText = (handle: string) => `Challenge sent. ${at(handle)} can accept it from their inbox.`;

/** How two readers stand, for the small badge beside a handle. */
export const relationText = (isFollowing: boolean, followsYou: boolean) =>
  isFollowing && followsYou ? "you follow each other" : followsYou ? "follows you" : null;
