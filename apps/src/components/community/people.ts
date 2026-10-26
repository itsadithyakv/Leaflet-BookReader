import type { FollowState, PersonCard } from "../../services/socialService";
import { minutesText } from "./format";

/**
 * The People tab's small rules, apart from what draws them so they can be
 * tested: how a card's follow button stands, and how pages of readers join.
 */

/** What a follow (or a request) the server answered leaves the button saying. */
export const stateAfter = (result: { following: boolean; requested?: boolean }): FollowState =>
  result.following ? "following" : result.requested ? "requested" : "none";

/**
 * How the reader stands with a card's reader: what this page did last, else
 * what the server said, else not following. The same reader in two lists
 * (suggested, and the list under it) shows the same state.
 */
export const stateOf = (card: Pick<PersonCard, "handle" | "followState">, changed: Record<string, FollowState>): FollowState =>
  changed[card.handle] ?? card.followState ?? "none";

/** What a tap on the button asks for: follow (or ask to), or undo a follow or a request. */
export const tapWants = (state: FollowState) => state === "none";

/** A page added to those shown: each reader once, in the order they came. */
export const joinPages = (shown: PersonCard[], page: PersonCard[]): PersonCard[] => {
  const seen = new Set(shown.map((card) => card.handle));
  return [...shown, ...page.filter((card) => !seen.has(card.handle) && seen.add(card.handle))];
};

/**
 * The line under a card's name: this week's minutes, or nothing for a locked
 * card (there are none to show) or one whose minutes were not sent (an older
 * server's list of whom the reader follows).
 */
export const weekLine = (card: Pick<PersonCard, "locked" | "weekMinutes">) =>
  card.locked || !Number.isFinite(card.weekMinutes) ? null : `${minutesText(card.weekMinutes)} this week`;

/** A count after a follow changed by this page: one more or one fewer, never below none. */
export const movedCount = (count: number | null, before: FollowState, after: FollowState) => {
  if (count === null) return null;
  const was = before === "following" ? 1 : 0;
  const now = after === "following" ? 1 : 0;
  return Math.max(0, count + now - was);
};
