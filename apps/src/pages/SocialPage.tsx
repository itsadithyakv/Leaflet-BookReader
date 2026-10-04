import { useMemo, useState } from "react";
import type { Book } from "@shared/models/book";
import { useLibraryStore } from "../store/libraryStore";
import { useHabitStore } from "../store/habitStore";
import { isFinished } from "../constants/books";
import { SocialPanel, type SocialNavTarget } from "../components/SocialPanel";
import { SessionShelf } from "../components/SessionShelf";
import { ReadingCalendar } from "../components/ReadingCalendar";
import { CountUp } from "../components/community/CountUp";
import { minutesText } from "../components/community/format";
import { weekMinutesOf } from "../components/community/ownRow";
import { streakText } from "../components/community/copy";
import { EYEBROW } from "../components/ui/SectionHeader";
import { SegmentedTabs, panelId, tabId } from "../components/ui/SegmentedTabs";

type SocialView = "stats" | "community";
const VIEW_KEY = "leaflet.social.view";
const ID = "social";

const readView = (): SocialView => {
  try {
    return localStorage.getItem(VIEW_KEY) === "community" ? "community" : "stats";
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
  const finishedBooks = useMemo(() => books.filter((book) => isFinished(book.progress)).length, [books]);

  const tiles = [
    { label: "This week", value: stats.weekMinutes, format: minutesText },
    { label: "Streak", value: snapshot.streak, format: streakText },
    { label: "Best streak", value: snapshot.longestStreak, format: streakText },
    { label: "Books finished", value: finishedBooks, format: String },
    { label: "Days read", value: stats.daysRead, format: String },
    { label: "Total time", value: stats.totalMinutes, format: minutesText }
  ];

  return (
    <div className="flex min-h-full flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title text-4xl text-on-surface">Social</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            {view === "stats" ? "Your reading, in numbers and spines." : "This week's board, the readers you follow, duels and kudos."}
          </p>
        </div>
        <SegmentedTabs
          label="Social"
          idPrefix={ID}
          size="md"
          value={view}
          onChange={chooseView}
          tabs={[
            { id: "stats", label: "Stats", hint: "Your numbers, calendar and session shelf" },
            { id: "community", label: "Community", hint: "The board, following, duels and kudos" }
          ]}
        />
      </header>

      {view === "community" ? (
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
          <section className="grid grid-cols-2 gap-4 md:grid-cols-3" aria-label="Your numbers">
            {tiles.map((tile) => (
              <div key={tile.label} className="paper-surface rounded-xl p-5">
                <p className={EYEBROW}>{tile.label}</p>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-on-surface">
                  <CountUp value={Math.round(tile.value)} format={tile.format} />
                </p>
              </div>
            ))}
          </section>

          <ReadingCalendar days={snapshot.days} goalMinutes={snapshot.goalMinutes} freeReads={snapshot.freeReads} />

          <SessionShelf />
        </div>
      )}
    </div>
  );
};
