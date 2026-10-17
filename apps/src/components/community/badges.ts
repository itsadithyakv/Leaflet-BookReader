/**
 * What each badge is called, and what earned it.
 *
 * The rules are Rust's (`habit/badges.rs`): it decides which are earned, from
 * the day ledger, the shelf and the shop's records, and a profile publishes
 * only the ids. This file is the words, for the reader's own badge wall and
 * for the row of badges on another reader's card. An id this build does not
 * know (a newer app's badge on an older one) is simply not shown.
 */

export type BadgeKind = "streak" | "hours" | "books" | "sessions" | "day" | "garden" | "collector" | "arcade" | "level" | "month" | "kudos";

export type BadgeInfo = {
  id: string;
  kind: BadgeKind;
  name: string;
  /** What it takes, as a short phrase: "Read 30 days in a row". */
  earnedBy: string;
  /** How hard it is, 1 to 4: sets the badge's metal (bronze, silver, gold, emerald). */
  tier: 1 | 2 | 3 | 4;
};

/** Different readers it takes for each kudos badge: the server counts to this and no further. */
export const KUDOS_BADGE_AT = 10;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const FIXED: BadgeInfo[] = [
  { id: "streak-7", kind: "streak", name: "A week of it", earnedBy: "Read 7 days in a row", tier: 1 },
  { id: "streak-30", kind: "streak", name: "A month of it", earnedBy: "Read 30 days in a row", tier: 2 },
  { id: "streak-100", kind: "streak", name: "Hundred days", earnedBy: "Read 100 days in a row", tier: 3 },
  { id: "streak-365", kind: "streak", name: "A year of days", earnedBy: "Read 365 days in a row", tier: 4 },
  { id: "hours-10", kind: "hours", name: "Ten hours", earnedBy: "Read for 10 hours in all", tier: 1 },
  { id: "hours-50", kind: "hours", name: "Fifty hours", earnedBy: "Read for 50 hours in all", tier: 2 },
  { id: "hours-100", kind: "hours", name: "Hundred hours", earnedBy: "Read for 100 hours in all", tier: 3 },
  { id: "hours-500", kind: "hours", name: "Five hundred hours", earnedBy: "Read for 500 hours in all", tier: 4 },
  { id: "books-1", kind: "books", name: "First book", earnedBy: "Finish a book", tier: 1 },
  { id: "books-10", kind: "books", name: "Ten books", earnedBy: "Finish 10 books", tier: 2 },
  { id: "books-25", kind: "books", name: "Twenty-five books", earnedBy: "Finish 25 books", tier: 2 },
  { id: "books-50", kind: "books", name: "Fifty books", earnedBy: "Finish 50 books", tier: 3 },
  { id: "books-100", kind: "books", name: "Hundred books", earnedBy: "Finish 100 books", tier: 4 },
  { id: "sessions-10", kind: "sessions", name: "In focus", earnedBy: "Complete 10 focus sessions", tier: 1 },
  { id: "sessions-100", kind: "sessions", name: "Deep focus", earnedBy: "Complete 100 focus sessions", tier: 2 },
  { id: "sessions-500", kind: "sessions", name: "Unshakeable", earnedBy: "Complete 500 focus sessions", tier: 4 },
  { id: "marathon-120", kind: "day", name: "Marathon", earnedBy: "Read for two hours in one day", tier: 2 },
  { id: "harvest-10", kind: "garden", name: "Green fingers", earnedBy: "Harvest 10 plants", tier: 1 },
  { id: "harvest-100", kind: "garden", name: "Market gardener", earnedBy: "Harvest 100 plants", tier: 3 },
  { id: "collector-10", kind: "collector", name: "Collector", earnedBy: "Own 10 things from Pip's shop", tier: 1 },
  { id: "collector-50", kind: "collector", name: "Curator", earnedBy: "Own 50 things from Pip's shop", tier: 2 },
  { id: "collector-100", kind: "collector", name: "Museum", earnedBy: "Own 100 things from Pip's shop", tier: 4 },
  { id: "arcade-dash-100", kind: "arcade", name: "Dasher", earnedBy: "Score 100 in Pip Dash", tier: 2 },
  { id: "arcade-catch-100", kind: "arcade", name: "Safe hands", earnedBy: "Score 100 in Leaf Catch", tier: 2 },
  { id: "arcade-flap-25", kind: "arcade", name: "Page turner", earnedBy: "Score 25 in Page Flap", tier: 2 },
  { id: "level-5", kind: "level", name: "Level 5", earnedBy: "Reach level 5", tier: 1 },
  { id: "level-10", kind: "level", name: "Level 10", earnedBy: "Reach level 10", tier: 2 },
  { id: "level-20", kind: "level", name: "Level 20", earnedBy: "Reach level 20", tier: 4 },
  // Granted by the server, not by Rust: counted by different readers, so one friend's kudos every day do not earn them.
  { id: "kudos-to-10", kind: "kudos", name: "Cheerleader", earnedBy: `Send kudos to ${KUDOS_BADGE_AT} different readers`, tier: 1 },
  { id: "kudos-from-10", kind: "kudos", name: "Well-liked", earnedBy: `Get kudos from ${KUDOS_BADGE_AT} different readers`, tier: 2 }
];

/**
 * The two kudos badges, as the badge wall shows them (earned, or how near):
 * from the counts the server keeps of different readers (`kudosFrom`,
 * `kudosTo` on the reader's own profile), which stop at the badge's ten.
 */
export const kudosBadgeStatuses = (counts: { kudosFrom?: number; kudosTo?: number } | null | undefined) => {
  const status = (id: string, count: number | undefined) => {
    const value = Math.max(0, Math.min(KUDOS_BADGE_AT, Math.floor(count ?? 0)));
    return { id, earned: value >= KUDOS_BADGE_AT, value, target: KUDOS_BADGE_AT };
  };
  return [status("kudos-to-10", counts?.kudosTo), status("kudos-from-10", counts?.kudosFrom)];
};

const BY_ID = new Map(FIXED.map((badge) => [badge.id, badge]));

/** `month-2026-10-500`: a calendar month in which so many minutes were read. */
const MONTH = /^month-(\d{4})-(\d{2})-(500|1000)$/;

/** What a badge id means, or null for one this build does not know. */
export const badgeInfo = (id: string): BadgeInfo | null => {
  const fixed = BY_ID.get(id);
  if (fixed) {
    return fixed;
  }
  const month = MONTH.exec(id);
  if (!month) {
    return null;
  }
  const name = MONTHS[Number(month[2]) - 1];
  if (!name) {
    return null;
  }
  const minutes = Number(month[3]);
  return {
    id,
    kind: "month",
    name: `${name} ${month[1]}${minutes === 1000 ? ", doubled" : ""}`,
    earnedBy: `Read ${minutes.toLocaleString("en")} minutes in ${name} ${month[1]}`,
    tier: minutes === 1000 ? 3 : 2
  };
};

/** The badges to show for a list of earned ids: the known ones, hardest first, then as given. */
export const shownBadges = (ids: readonly string[] | null | undefined, most = Number.POSITIVE_INFINITY): BadgeInfo[] => {
  const known = (ids ?? []).map(badgeInfo).filter((badge): badge is BadgeInfo => badge !== null);
  // A stable sort: within a tier they stay in the order Rust lists them.
  return known
    .map((badge, at) => ({ badge, at }))
    .sort((a, b) => b.badge.tier - a.badge.tier || a.at - b.at)
    .slice(0, most)
    .map((entry) => entry.badge);
};

/** How far along a badge is, in its own words: "23 of 30 days". */
export const progressText = (kind: BadgeKind, value: number, target: number): string => {
  const whole = (number: number) => Math.floor(number).toLocaleString("en");
  switch (kind) {
    case "streak":
      return `${whole(value)} of ${whole(target)} days`;
    case "hours":
      return `${whole(value)} of ${whole(target)} hours`;
    case "books":
      return `${whole(value)} of ${whole(target)} books`;
    case "sessions":
      return `${whole(value)} of ${whole(target)} sessions`;
    case "day":
    case "month":
      return `${whole(value)} of ${whole(target)} minutes`;
    case "garden":
      return `${whole(value)} of ${whole(target)} harvests`;
    case "collector":
      return `${whole(value)} of ${whole(target)} things`;
    case "arcade":
      return `Best ${whole(value)} of ${whole(target)}`;
    case "level":
      return `Level ${whole(value)} of ${whole(target)}`;
    case "kudos":
      return `${whole(value)} of ${whole(target)} readers`;
  }
};
