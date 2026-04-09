import { useEffect, useMemo, useState } from "react";
import type { Book } from "@shared/models/book";
import { useHabitStore, buildDateRange, getDateKey, getSessionProgress, isGoalMet } from "../store/habitStore";

type HomePageProps = {
  nowReading: Book | null;
  onOpenBook: (book: Book) => void;
};

const motivationMessages = [
  "A few quiet pages can change the entire day.",
  "Small sessions grow big forests.",
  "You only need to begin.",
  "Consistency beats intensity.",
  "Let the next page be gentle."
];

const formatMinutes = (minutes: number) => `${Math.round(minutes)}m`;

export const HomePage = ({ nowReading, onOpenBook }: HomePageProps) => {
  const {
    goal,
    sessions,
    forest,
    daily,
    setGoal,
    markGoalComplete,
    activeSession,
    startSession,
    stopSession,
    focusSettings,
    addSessionNote
  } = useHabitStore();
  const todayKey = getDateKey();
  const todayRecord = daily[todayKey];
  const todayMinutes = todayRecord?.minutes ?? 0;
  const goalMet = isGoalMet(goal, todayRecord);
  const percent = goal.mode === "minutes" && goal.target > 0
    ? Math.min(100, Math.round((todayMinutes / goal.target) * 100))
    : goalMet
      ? 100
      : 0;

  const [sessionDuration, setSessionDuration] = useState(20);
  const [sessionRemaining, setSessionRemaining] = useState<number | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSessionId, setNoteSessionId] = useState<string | null>(null);

  const weeklyKeys = useMemo(() => buildDateRange(7), []);
  const weeklySummary = weeklyKeys.map((key) => ({
    key,
    minutes: daily[key]?.minutes ?? 0
  }));

  const totalMinutes = useMemo(
    () => sessions.reduce((sum, session) => sum + session.durationMinutes, 0),
    [sessions]
  );

  const streak = useMemo(() => {
    let count = 0;
    for (let i = 0; i < 365; i += 1) {
      const key = getDateKey(new Date(Date.now() - i * 86400000));
      if (isGoalMet(goal, daily[key])) {
        count += 1;
      } else {
        break;
      }
    }
    return count;
  }, [goal, daily]);

  const handleStartSession = () => {
    if (activeSession) {
      return;
    }
    startSession({
      startedAt: new Date().toISOString(),
      durationMinutes: sessionDuration,
      bookId: nowReading?.id,
      title: nowReading?.title
    });
  };

  useEffect(() => {
    if (!activeSession) {
      setSessionRemaining(null);
      return undefined;
    }
    const timer = window.setInterval(() => {
      const remaining = Math.max(
        0,
        activeSession.durationMinutes * 60 -
          Math.round((Date.now() - Date.parse(activeSession.startedAt)) / 1000)
      );
      if (remaining <= 0) {
        const sessionId = stopSession({ reason: "completed", cleanSession: true });
        if (sessionId && focusSettings.sessionNotes) {
          setNoteSessionId(sessionId);
          setNoteText("");
          setNoteModalOpen(true);
        }
      } else {
        setSessionRemaining(remaining);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeSession, stopSession]);

  const progressRing = activeSession ? getSessionProgress(activeSession) : 0;

  const motivational = motivationMessages[Math.floor(Date.now() / 1000) % motivationMessages.length];

  return (
    <div className="flex min-h-full flex-col gap-8">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-8">
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Today</p>
          <h1 className="mt-2 text-3xl font-headline font-bold text-on-surface">Welcome back</h1>
          <p className="mt-3 text-sm text-on-surface-variant">{motivational}</p>

          <div className="mt-6 rounded-2xl border border-outline-variant/20 bg-surface-container-high p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-on-surface">Daily Goal</p>
              <div className="flex items-center gap-2">
                <select
                  className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1 text-xs text-on-surface"
                  value={goal.mode}
                  onChange={(event) =>
                    setGoal({ ...goal, mode: event.target.value as typeof goal.mode })
                  }
                >
                  <option value="minutes">Minutes</option>
                  <option value="pages">Pages</option>
                  <option value="chapters">Chapters</option>
                </select>
                <input
                  type="number"
                  min={1}
                  className="w-20 rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1 text-xs text-on-surface"
                  value={goal.target}
                  onChange={(event) => setGoal({ ...goal, target: Number(event.target.value) })}
                />
              </div>
            </div>
            <div className="mt-4">
              <div className="h-2 w-full rounded-full bg-surface-container-highest">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
                <span>{goal.mode === "minutes" ? `${formatMinutes(todayMinutes)} / ${goal.target}m` : "Manual goal"}</span>
                <span>{percent}%</span>
              </div>
              {goal.mode !== "minutes" && (
                <button
                  type="button"
                  className="mt-3 rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary"
                  onClick={() => markGoalComplete(todayKey, !goalMet)}
                >
                  {goalMet ? "Mark incomplete" : "Mark complete"}
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-high px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Streak</p>
              <p className="mt-2 text-2xl font-headline font-bold text-on-surface">{streak} days</p>
            </div>
            <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-high px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Total Time</p>
              <p className="mt-2 text-2xl font-headline font-bold text-on-surface">{formatMinutes(totalMinutes)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Continue Reading</p>
          <div className="mt-4">
            {nowReading ? (
              <>
                <h2 className="text-xl font-headline font-bold text-on-surface">{nowReading.title}</h2>
                <p className="mt-2 text-sm text-on-surface-variant">{nowReading.author ?? "Unknown author"}</p>
                <button
                  type="button"
                  className="mt-6 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-on-primary"
                  onClick={() => onOpenBook(nowReading)}
                >
                  Continue Reading
                </button>
              </>
            ) : (
              <p className="text-sm text-on-surface-variant">Import a book to start reading.</p>
            )}
          </div>

          <div className="mt-8 rounded-2xl border border-outline-variant/20 bg-surface-container-high p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Focus Session</p>
            <div className="mt-3 flex items-center gap-3">
              <select
                className="flex-1 rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface"
                value={sessionDuration}
                onChange={(event) => setSessionDuration(Number(event.target.value))}
              >
                <option value={10}>10 min</option>
                <option value={20}>20 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
              </select>
              <button
                type="button"
                className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleStartSession}
                disabled={Boolean(activeSession)}
              >
                {activeSession ? "Active" : "Start"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Forest</p>
            <span className="text-xs text-on-surface-variant">{forest.length} plants</span>
          </div>
          <div className="mt-5 grid grid-cols-6 gap-3">
            {forest.slice(-30).map((item) => (
              <div
                key={item.id}
                title={item.dateKey}
                className={`rounded-full border border-outline-variant/30 ${
                  item.size === "tree"
                    ? "h-10 w-10 bg-primary/20"
                    : item.size === "sapling"
                      ? "h-8 w-8 bg-primary/15"
                      : "h-6 w-6 bg-primary/10"
                } ${item.style === "glow" ? "scale-[1.08] shadow-[0_0_12px_rgba(101,168,63,0.5)] ring-2 ring-primary/40" : ""}`}
              />
            ))}
            {forest.length === 0 && (
              <p className="col-span-6 text-sm text-on-surface-variant">Complete a session to grow your forest.</p>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Weekly Summary</p>
          <div className="mt-4 space-y-3">
            {weeklySummary.map((day) => (
              <div key={day.key} className="flex items-center gap-3">
                <span className="w-20 text-xs text-on-surface-variant">{day.key.slice(5)}</span>
                <div className="h-2 flex-1 rounded-full bg-surface-container-highest">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (day.minutes / Math.max(goal.target, 1)) * 100)}%` }}
                  />
                </div>
                <span className="w-10 text-right text-xs text-on-surface-variant">{formatMinutes(day.minutes)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {activeSession && sessionRemaining !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-3xl border border-outline-variant/20 bg-surface-container-high p-8 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Focus Session</p>
            <h2 className="mt-3 text-2xl font-headline font-bold text-on-surface">
              {Math.floor(sessionRemaining / 60)}:{String(sessionRemaining % 60).padStart(2, "0")}
            </h2>
            <div className="mt-6 flex items-center justify-center">
              <svg width="140" height="140">
                <circle cx="70" cy="70" r="60" stroke="#1c1b1b" strokeWidth="8" fill="none" />
                <circle
                  cx="70"
                  cy="70"
                  r="60"
                  stroke="#65a83f"
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray={2 * Math.PI * 60}
                  strokeDashoffset={(1 - progressRing) * 2 * Math.PI * 60}
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <button
              type="button"
              className="mt-6 rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary"
              onClick={() => {
                const sessionId = stopSession({ reason: "manual_end", cleanSession: true });
                if (sessionId && focusSettings.sessionNotes) {
                  setNoteSessionId(sessionId);
                  setNoteText("");
                  setNoteModalOpen(true);
                }
              }}
            >
              End Session
            </button>
          </div>
        </div>
      )}

      {noteModalOpen && noteSessionId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-2xl border border-outline-variant/20 bg-surface-container-low p-6">
            <div className="text-xs uppercase tracking-widest text-on-surface-variant">Session Notes</div>
            <h3 className="mt-2 text-lg font-headline font-bold text-on-surface">Add a quick note</h3>
            <textarea
              className="mt-4 h-28 w-full resize-none rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface"
              placeholder="What did you read or learn?"
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
            />
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                className="rounded-full border border-outline-variant/30 px-4 py-2 text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-primary"
                onClick={() => {
                  setNoteModalOpen(false);
                  setNoteSessionId(null);
                  setNoteText("");
                }}
              >
                Skip
              </button>
              <button
                type="button"
                className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-on-primary"
                onClick={() => {
                  if (noteText.trim()) {
                    addSessionNote(noteSessionId, noteText.trim());
                  }
                  setNoteModalOpen(false);
                  setNoteSessionId(null);
                  setNoteText("");
                }}
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
