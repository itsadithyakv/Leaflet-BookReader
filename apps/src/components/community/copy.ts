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
    "Look around as much as you like. To appear on the board, follow readers, send kudos and duel, sign in under Settings → Account and share your profile.",
  goPublic: "Share your profile to join in. Only readers who share appear on the board.",
  notConnected:
    "The community needs a Leaflet server, the only part of the app that has one. Add its address in Settings. Everything else, including backup, works without it.",
  comingSoon: "Weekly boards, following and shared shelves are on their way. Your reading is already being counted, so nothing you read now is lost.",
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
