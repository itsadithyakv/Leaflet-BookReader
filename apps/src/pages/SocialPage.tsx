import { useMemo, useState } from "react";
import type { Book } from "@shared/models/book";
import { useLibraryStore } from "../store/libraryStore";
import { useHabitStore } from "../store/habitStore";
import { hasFinished } from "../constants/books";
import { useBooksRead } from "../library/finishedBooks";
import { SocialPanel, type SocialNavTarget } from "../components/SocialPanel";
import { FriendsPanel } from "../components/community/FriendsPanel";
import { ReaderCard } from "../components/community/ReaderCard";
import { useCommunityStore } from "../components/community/communityStore";
import { CommunitiesTab, DiscoverPanel } from "../components/discuss/DiscussPanels";
import { BookPostsDrawer } from "../components/discuss/DiscoverPanel";
import { useDiscussStore } from "../components/discuss/discussStore";
import { useAccountStore } from "../store/accountStore";
import { BadgesCard } from "../components/community/BadgesCard";
import { SessionShelf } from "../components/SessionShelf";
import { ReadingCalendar } from "../components/ReadingCalendar";
import { YearGoalCard } from "../components/goal/YearGoalCard";
import { openYearReview } from "../components/share/shareStore";
import { yearsRead } from "../components/share/yearReview";
import { CountUp } from "../components/community/CountUp";
import { minutesText } from "../components/community/format";
import { weekMinutesOf } from "../components/community/ownRow";
import { streakText } from "../components/community/copy";
import { EYEBROW } from "../components/ui/SectionHeader";
import { SegmentedTabs, panelId, tabId } from "../components/ui/SegmentedTabs";

type SocialView = "stats" | "community" | "friends" | "discover" | "communities";
const VIEWS: SocialView[] = ["stats", "community", "friends", "discover", "communities"];
const VIEW_KEY = "leaflet.social.view";
const ID = "social";

const readView = (): SocialView => {
  try {
    const kept = localStorage.getItem(VIEW_KEY) as SocialView | null;
    return kept && VIEWS.includes(kept) ? kept : "stats";
  } catch {
    return "stats";
  }
};

export type SocialPageProps = {
  showToast: (message: string) => void;
  /** The book the board's "keep reading" opens. */
  nowReading: Book | null;
  /** Starts a session of this many minutes on `nowReading` and opens it. */
  onReadNow: (minutes: number) => void;
  onNavigate: (tab: SocialNavTarget) => void;
};

/**
 * Two halves: your own reading (Stats) and everyone else's (Community). On one
 * long page the community sat below a screenful of personal numbers and looked
 * absent.
 */
export const SocialPage = ({ showToast, nowReading, onReadNow, onNavigate }: SocialPageProps) => {
  // The community half needs a Leaflet server; the stats work without one.
  const apiBase = useLibraryStore((state) => state.sync.apiBase);
  const books = useLibraryStore((state) => state.books);
  const snapshot = useHabitStore((state) => state.snapshot);
  const [view, setView] = useState<SocialView>(readView);
  // Another reader's page opens from every tab (a name in a feed, a thread,
  // a club), so it is shown here, not on the board alone.
  const openHandle = useCommunityStore((state) => state.openHandle);
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const me = useCommunityStore((state) => state.me);
  const canJoin = signedIn && Boolean(me) && me?.visibility !== "private" && Boolean(me?.handle);
  const refreshBoards = () => {
    const community = useCommunityStore.getState();
    void community.loadBoard("everyone");
    if (signedIn) {
      void community.loadBoard("following");
      void community.loadDuels();
    }
  };
  const chooseView = (next: SocialView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Remembering the tab is a nicety.
    }
  };

  // Every figure here is the one your public card shows, computed the same
  // way: minutes from the day ledger (fed by the reading heartbeat), this week
  // from Monday in your own time zone, and "finished" by the one shared rule.
  const stats = useMemo(() => {
    // The one sum the board uses for your own row too.
    const weekMinutes = weekMinutesOf(snapshot.days);
    const totalMinutes = snapshot.days.reduce((sum, day) => sum + day.minutes, 0);
    const daysRead = snapshot.days.filter((day) => day.minutes > 0).length;
    return { weekMinutes, totalMinutes, daysRead };
  }, [snapshot.days]);
  // With the ones finished and since removed (library/finishedBooks.ts).
  const booksRead = useBooksRead();
  const finishedBooks = useMemo(() => booksRead.filter(hasFinished).length, [booksRead]);
  // The latest year there is any reading in; none on a new library.
  const reviewYear = useMemo(() => yearsRead(snapshot.days)[0] ?? null, [snapshot.days]);

  const tiles = [
    { label: "This week", value: stats.weekMinutes, format: minutesText },
    { label: "Streak", value: snapshot.streak, format: streakText },
    { label: "Best streak", value: snapshot.longestStreak, format: streakText },
    { label: "Books finished", value: finishedBooks, format: String },
    { label: "Days read", value: stats.daysRead, format: String },
    { label: "Total time", value: stats.totalMinutes, format: minutesText }
  ];

  const bookPosts = (
    <BookPostsDrawer
      showToast={showToast}
      onOpenCommunity={(id) => {
        useCommunityStore.getState().closeReader();
        useDiscussStore.getState().go({ at: "community", id });
        chooseView("communities");
      }}
    />
  );

  // Another reader's page stands in for the tabs while it is open; Back returns to the tab it was opened from.
  if (openHandle) {
    return (
      <div className="dock-clear mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-8">
        <ReaderCard signedIn={signedIn} canJoin={canJoin} showToast={showToast} onChanged={refreshBoards} />
        {bookPosts}
      </div>
    );
  }

  return (
    <div className="dock-clear mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-8">
      <header className="social-head flex flex-wrap items-end justify-between gap-4">
        {/* What each tab holds is its tooltip (`hint`), not a sentence standing under the title. */}
        <h1 className="page-title text-4xl text-on-surface">Social</h1>
        <SegmentedTabs
          label="Social"
          idPrefix={ID}
          size="md"
          value={view}
          onChange={chooseView}
          tabs={[
            { id: "stats", label: "Stats", hint: "Your numbers, calendar and session shelf" },
            { id: "community", label: "Board", hint: "The board, following, duels and kudos" },
            { id: "friends", label: "Friends", hint: "The feed, books in common and book clubs" },
            { id: "discover", label: "Discover", hint: "Reviews and quotes from readers everywhere" },
            { id: "communities", label: "Communities", hint: "A place to talk over each book or series" }
          ]}
        />
      </header>

      {bookPosts}

      {view === "discover" ? (
        <div role="tabpanel" id={panelId(ID, "discover")} aria-labelledby={tabId(ID, "discover")} className="flex flex-col gap-6">
          <DiscoverPanel showToast={showToast} onNavigate={onNavigate} />
        </div>
      ) : view === "communities" ? (
        <div role="tabpanel" id={panelId(ID, "communities")} aria-labelledby={tabId(ID, "communities")} className="flex flex-col gap-6">
          <CommunitiesTab showToast={showToast} onNavigate={onNavigate} />
        </div>
      ) : view === "friends" ? (
        <div role="tabpanel" id={panelId(ID, "friends")} aria-labelledby={tabId(ID, "friends")} className="flex flex-col gap-6">
          <FriendsPanel showToast={showToast} onNavigate={onNavigate} />
        </div>
      ) : view === "community" ? (
        <div role="tabpanel" id={panelId(ID, "community")} aria-labelledby={tabId(ID, "community")} className="flex flex-col gap-6">
          <SocialPanel
            configured={Boolean(apiBase)}
            showToast={showToast}
            nowReading={nowReading}
            onReadNow={onReadNow}
            onNavigate={onNavigate}
          />
        </div>
      ) : (
        <div role="tabpanel" id={panelId(ID, "stats")} aria-labelledby={tabId(ID, "stats")} className="flex flex-col gap-8">
          <section className="stat-tiles grid grid-cols-2 gap-4 md:grid-cols-3" aria-label="Your numbers">
            {tiles.map((tile) => (
              <div key={tile.label} className="stat-tile paper-surface rounded-xl p-5">
                <p className={EYEBROW}>{tile.label}</p>
                <p className="stat-tile-value mt-3 text-3xl font-semibold tabular-nums text-on-surface">
                  <CountUp value={Math.round(tile.value)} format={tile.format} />
                </p>
              </div>
            ))}
          </section>

          <BadgesCard />

          <YearGoalCard />

          {/* The year as a story to look back on and share (components/share/year). */}
          {reviewYear !== null && (
            <button
              type="button"
              className="paper-surface flex items-center justify-between gap-4 rounded-xl p-5 text-left transition hover:text-primary"
              onClick={() => openYearReview(reviewYear)}
            >
              <span>
                <span className={EYEBROW}>Year in review</span>
                <span className="mt-2 block text-xl font-semibold text-on-surface">Your {reviewYear} in pages</span>
              </span>
              <span className="material-symbols-outlined text-on-surface-variant" aria-hidden="true">
                chevron_right
              </span>
            </button>
          )}

          <ReadingCalendar days={snapshot.days} goalMinutes={snapshot.goalMinutes} freeReads={snapshot.freeReads} />

          <SessionShelf />
        </div>
      )}
    </div>
  );
};
