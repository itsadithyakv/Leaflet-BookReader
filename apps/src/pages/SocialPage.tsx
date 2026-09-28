import { useEffect, useMemo, useState } from "react";
import { useLibraryStore } from "../store/libraryStore";
import { useHabitStore, buildDateRange, shelfSessions } from "../store/habitStore";
import { SocialPanel } from "../components/SocialPanel";
import { SessionShelf } from "../components/SessionShelf";

const minutesLabel = (minutes: number) => `${Math.round(minutes)}m`;

type SocialView = "you" | "community";
const VIEW_KEY = "leaflet.social.view";

const readView = (): SocialView => {
  try {
    return localStorage.getItem(VIEW_KEY) === "community" ? "community" : "you";
  } catch {
    return "you";
  }
};

const useCountUp = (target: number) => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 900;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
};

export type SocialPageProps = {
  showToast: (message: string) => void;
};

export const SocialPage = ({ showToast }: SocialPageProps) => {
  // The community half needs a Leaflet server; everything above works without one.
  const apiBase = useLibraryStore((state) => state.sync.apiBase);
  const { books } = useLibraryStore();
  const snapshot = useHabitStore((state) => state.snapshot);
  // Two halves: your own reading, and everyone else's. On one long page the
  // community sat below a screenful of personal stats and looked absent.
  const [view, setView] = useState<SocialView>(readView);
  const chooseView = (next: SocialView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Remembering the tab is a nicety.
    }
  };

  // Every session counts, including ones ended early. They are real reading and
  // they already fed the day ledger; filtering them out here was what made the
  // metric tiles disagree with the charts below them.
  const metricSessions = useMemo(() => shelfSessions(snapshot), [snapshot]);

  // The ledger, keyed for the charts.
  const dailySource = useMemo(() => {
    const map: Record<string, { minutes: number; met: boolean }> = {};
    for (const day of snapshot.days) {
      map[day.dateKey] = {
        minutes: day.minutes,
        met: day.freezeUsed || day.graceUsed || (day.goalMinutes > 0 && day.minutes >= day.goalMinutes)
      };
    }
    return map;
  }, [snapshot.days]);

  const goalMinutes = snapshot.goalMinutes;
  const hasHistory = metricSessions.length > 0 || snapshot.days.length > 0;

  // Total time comes from the ledger, not from session durations: the ledger is
  // fed by the reading heartbeat, so it counts time actually spent reading
  // rather than time a timer happened to be running.
  const totalMinutes = useMemo(
    () => snapshot.days.reduce((sum, day) => sum + day.minutes, 0),
    [snapshot.days]
  );
  const averageSession = metricSessions.length > 0
    ? metricSessions.reduce((sum, session) => sum + session.minutes, 0) / metricSessions.length
    : 0;
  const finishedBooks = books.filter((book) => book.progress >= 1).length;
  // Replaces the old "Pages Read", which was minutes multiplied by one. Days
  // read is something the app can actually observe.
  const daysRead = useMemo(
    () => snapshot.days.filter((day) => day.minutes > 0).length,
    [snapshot.days]
  );

  const longestStreak = snapshot.longestStreak;

  const last30Keys = useMemo(() => buildDateRange(30), []);
  const consistencyScore = useMemo(() => {
    const met = last30Keys.filter((key) => dailySource[key]?.met).length;
    return Math.round((met / last30Keys.length) * 100);
  }, [dailySource, last30Keys]);

  const monthlyChart = last30Keys.map((key) => dailySource[key]?.minutes ?? 0);
  const weeklyKeys = useMemo(() => buildDateRange(7), []);

  const totalMinutesDisplay = useCountUp(totalMinutes);
  const avgSessionDisplay = useCountUp(averageSession);
  const finishedBooksDisplay = useCountUp(finishedBooks);
  const daysReadDisplay = useCountUp(daysRead);
  const longestStreakDisplay = useCountUp(longestStreak);
  const consistencyDisplay = useCountUp(consistencyScore);


  const tab = (id: SocialView, label: string, hint: string) => (
    <button
      type="button"
      role="tab"
      id={`social-tab-${id}`}
      aria-selected={view === id}
      aria-controls={`social-panel-${id}`}
      className={`tactile-button px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${view === id ? "tactile-button-primary" : ""}`}
      onClick={() => chooseView(id)}
      title={hint}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-full flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title text-4xl text-on-surface">Social</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            {view === "you" ? "Your reading, in numbers and spines." : "Friendly competition: this week's boards, friends, duels and kudos."}
          </p>
        </div>
        <div className="flex gap-2" role="tablist" aria-label="Social">
          {tab("you", "You", "Your stats and session bookshelf")}
          {tab("community", "Community", "Leaderboards, friends, duels and kudos")}
        </div>
      </header>

      {view === "community" ? (
        <div role="tabpanel" id="social-panel-community" aria-labelledby="social-tab-community">
          <SocialPanel configured={Boolean(apiBase)} showToast={showToast} />
        </div>
      ) : (
      <div role="tabpanel" id="social-panel-you" aria-labelledby="social-tab-you" className="flex flex-col gap-10">
      <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {[
          { label: "Total Time", value: minutesLabel(totalMinutesDisplay) },
          { label: "Books Finished", value: finishedBooksDisplay },
          { label: "Days Read", value: daysReadDisplay },
          { label: "Average Session", value: minutesLabel(avgSessionDisplay) },
          { label: "Longest Streak", value: `${longestStreakDisplay} days` },
          { label: "Consistency", value: `${consistencyDisplay}%` }
        ].map((item) => (
          <div
            key={item.label}
            className="paper-surface rounded-xl p-5"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">{item.label}</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-on-surface">{item.value}</p>
          </div>
        ))}
      </section>

      <SessionShelf />

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="paper-surface rounded-xl p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Monthly Reading</p>
          <div className="mt-5 grid gap-1" style={{ gridTemplateColumns: "repeat(30, minmax(0, 1fr))" }}>
            {monthlyChart.map((minutes, index) => (
              <div
                key={`${minutes}-${index}`}
                title={`${minutesLabel(minutes)} on ${last30Keys[index]}`}
                className="h-10 rounded-sm bg-primary/20"
                style={{ opacity: Math.min(1, minutes / Math.max(goalMinutes, 1)) }}
              />
            ))}
          </div>
        </div>

        <div className="paper-surface rounded-xl p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Weekly Summary</p>
          <div className="mt-4 space-y-3">
            {weeklyKeys.map((key) => {
              const minutes = dailySource[key]?.minutes ?? 0;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-20 text-xs text-on-surface-variant">{key.slice(5)}</span>
                  <div className="h-2 flex-1 rounded-full bg-surface-container-highest">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${Math.min(100, (minutes / Math.max(goalMinutes, 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs text-on-surface-variant">{minutesLabel(minutes)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="paper-surface rounded-xl p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Reading Heatmap (30 days)</p>
        <div className="mt-5 grid grid-cols-10 gap-2">
          {last30Keys.map((key) => {
            const minutes = dailySource[key]?.minutes ?? 0;
            const intensity = Math.min(1, minutes / Math.max(goalMinutes, 1));
            return (
              <div
                key={key}
                title={`${key}: ${minutesLabel(minutes)}`}
                className="h-6 rounded-md bg-primary/20"
                style={{ opacity: 0.25 + intensity * 0.75 }}
              />
            );
          })}
        </div>
      </section>
      </div>
      )}
    </div>
  );
};
