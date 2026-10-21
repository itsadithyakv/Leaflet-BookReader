import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Trophy } from "lucide-react";
import { useBackClose } from "../../hooks/useBackClose";
import { usePhoneMenus, useSheetLayout } from "../../hooks/useMediaQuery";
import { getDateKey } from "../../services/habitService";
import { reminderService, type ReminderSettings } from "../../services/reminderService";
import { freezeRefusal, seedExtras, seedService } from "../../services/seedService";
import { useHabitStore } from "../../store/habitStore";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";
import { UiIcon } from "../UiIcon";
import { SheetHandle } from "../ui/SheetHandle";
import ScrollEdge from "../ui/ScrollEdge";
import { Burst, DayBubbleView, TickCount } from "./StreakArt";
import { FlameSprite, IceCube } from "./sprites";
import { flameState, nextMilestone, riskFrom, weekBubbles } from "./streakModel";
import { useStreakUi } from "./useStreakMoments";
import "./streak.css";

/** The reminder settings, asked for once: a daily reminder set early makes "at risk" come earlier. */
let reminders: Promise<ReminderSettings | null> | null = null;
const loadReminders = () => {
  reminders ??= reminderService
    .status()
    .then((status) => status.settings)
    .catch(() => null);
  return reminders;
};

/** Minutes after local midnight, again each minute. */
const useMinuteOfDay = () => {
  const now = () => {
    const date = new Date();
    return date.getHours() * 60 + date.getMinutes();
  };
  const [minute, setMinute] = useState(now);
  useEffect(() => {
    const timer = window.setInterval(() => setMinute(now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return minute;
};

/** The chip's look now: lit, embers, at risk (late, today undone) or out. */
export const useFlameState = () => {
  const snapshot = useHabitStore((state) => state.snapshot);
  const minute = useMinuteOfDay();
  const [riskAt, setRiskAt] = useState(() => riskFrom(null));
  useEffect(() => {
    let live = true;
    void loadReminders().then((settings) => live && setRiskAt(riskFrom(settings)));
    return () => {
      live = false;
    };
  }, []);
  return flameState(snapshot, minute, riskAt);
};

type Props = {
  /** Read today: the book being read (a session on it), or a session from the Library. */
  onRead: () => void;
  readLabel: string;
  /** The month's calendar (Social → Stats). */
  onOpenCalendar: () => void;
};

/**
 * The streak, Duolingo-style: a flame and the count in the header, lit once
 * today's goal is met. A tap opens the streak's own panel: the week, the
 * best run, the next milestone, the freezes held and one to buy.
 */
export const StreakButton = ({ onRead, readLabel, onOpenCalendar }: Props) => {
  const snapshot = useHabitStore((state) => state.snapshot);
  const open = useStreakUi((state) => state.open);
  const setOpen = useStreakUi((state) => state.setOpen);
  const moment = useStreakUi((state) => state.moment);
  const flame = useFlameState();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const narrow = useSheetLayout();
  const phoneMenus = usePhoneMenus();
  const sheet = narrow || phoneMenus;
  const close = () => setOpen(false);
  useBackClose(open, close);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sheet || rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, sheet, setOpen]);

  // Lit just now (a goal met, a milestone on it): the chip's flame grows with a burst and the count ticks over.
  const igniting = moment && (moment.kind === "goal" || (moment.kind === "milestone" && snapshot.todayMet)) ? moment : null;
  const label =
    flame === "lit"
      ? `${snapshot.streak}-day streak, today's goal met`
      : snapshot.streak > 0
        ? `${snapshot.streak}-day streak, ${flame === "risk" ? "at risk: " : ""}today not read yet`
        : "No streak yet: meet today's goal to start one";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="streak-chip"
        data-state={flame}
        data-tour="streak"
        onClick={() => setOpen(!open)}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="relative">
          <FlameSprite key={igniting ? `lit-${igniting.keys[0]}` : flame} state={flame} scale={2} className={igniting ? "streak-ignite" : ""} />
          {igniting && <Burst key={igniting.keys[0]} />}
        </span>
        {igniting ? <TickCount key={igniting.keys[0]} from={Math.max(0, snapshot.streak - 1)} to={snapshot.streak} /> : snapshot.streak}
      </button>
      {open && (
        <PanelFrame sheet={sheet} panelRef={panelRef} onClose={close}>
          <StreakPanel
            flame={flame}
            onRead={() => {
              close();
              onRead();
            }}
            readLabel={readLabel}
            onOpenCalendar={() => {
              close();
              onOpenCalendar();
            }}
          />
        </PanelFrame>
      )}
    </div>
  );
};

/** Hanging from the chip on a desktop; a sheet with a grip on a phone. */
const PanelFrame = ({
  sheet,
  panelRef,
  onClose,
  children
}: {
  sheet: boolean;
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: ReactNode;
}) => {
  if (!sheet) {
    return (
      <div ref={panelRef} role="dialog" aria-label="Your streak" className="anchored-panel modal-surface streak-panel absolute right-0 z-50 mt-3 rounded-xl p-4 text-on-surface">
        {children}
      </div>
    );
  }
  return createPortal(
    <div
      className="sheet-backdrop sheet-backdrop-menu fixed inset-0 z-[80] flex items-end justify-center bg-black/45"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div ref={panelRef} role="dialog" aria-label="Your streak" className="modal-surface sheet-panel streak-panel w-full p-4 text-on-surface">
        <SheetHandle onClose={onClose} />
        {children}
        <ScrollEdge edge="bottom" scroller="parent" />
      </div>
    </div>,
    document.body
  );
};

type PanelProps = { flame: ReturnType<typeof flameState>; onRead: () => void; readLabel: string; onOpenCalendar: () => void };

export const StreakPanel = ({ flame, onRead, readLabel, onOpenCalendar }: PanelProps) => {
  const snapshot = useHabitStore((state) => state.snapshot);
  const loadHabit = useHabitStore((state) => state.load);
  const overview = usePipWardrobeStore((state) => state.overview);
  const { freezes: shop } = seedExtras(overview);
  const balance = overview?.wallet.balance ?? 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = getDateKey();
  const week = weekBubbles(snapshot, today);
  const milestone = nextMilestone(snapshot.streak);
  const cap = shop?.cap ?? 2;
  const held = Math.min(cap, snapshot.freezes);
  const refusal = freezeRefusal(shop, balance);
  // A tap on a freeze that cannot be bought says why: a finger never sees the key's title.
  const [askedWhy, setAskedWhy] = useState(false);
  const left =Math.max(0, Math.ceil(snapshot.goalMinutes - snapshot.todayMinutes));

  // A cube that arrives while the panel is open (bought here, or earned by the streak) drops into its slot.
  const heldBefore = useRef(held);
  const [dropped, setDropped] = useState<number | null>(null);
  useEffect(() => {
    if (held > heldBefore.current) setDropped(held - 1);
    heldBefore.current = held;
  }, [held]);

  const buy = () => {
    setBusy(true);
    setError(null);
    seedService
      .buyFreeze(getDateKey())
      // The freeze is the streak's: the habit snapshot holds the count.
      .then(() => loadHabit())
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="streak-hero" data-state={flame}>
        <FlameSprite state={flame} scale={5} className="streak-hero-big" />
        <div className="min-w-0">
          <p className="streak-hero-count">{snapshot.streak}</p>
          <p className="mt-1 text-sm font-semibold text-on-surface-variant">day streak</p>
        </div>
        <p className="ml-auto self-start text-right text-[11px] text-on-surface-variant" title="Your longest streak">
          <Trophy size={13} className="mr-1 inline-block align-[-2px]" aria-hidden />
          <span className="font-semibold tabular-nums text-on-surface">{snapshot.longestStreak}</span>
        </p>
      </div>

      <div className="streak-week" role="list" aria-label="This week">
        {week.map((day) => (
          <div role="listitem" key={day.dateKey}>
            <DayBubbleView day={day} flame={flame} />
          </div>
        ))}
      </div>

      <div title={`${milestone.left} ${milestone.left === 1 ? "day" : "days"} to a ${milestone.target}-day streak`}>
        <div className="streak-line">
          <span>
            Next: <strong>{milestone.target} days</strong>
          </span>
          <span>{milestone.left} to go</span>
        </div>
        <div className="streak-meter mt-1.5" aria-hidden="true">
          <span style={{ width: `${Math.round(milestone.share * 100)}%` }} />
        </div>
      </div>

      <div className="section-rule flex items-center justify-between gap-3 pt-3">
        <div className="streak-tray" title={`Freezes: ${held} of ${cap}. Each covers one missed day.`} aria-label={`${held} of ${cap} freezes held`}>
          {Array.from({ length: cap }, (_, at) => (
            <span key={at} className="streak-slot" data-full={at < held}>
              {at < held && <IceCube key={at === dropped ? `drop-${held}` : "still"} scale={2} className={at === dropped ? "streak-ice-drop" : ""} />}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="streak-seeds" title="Your seeds">
            <UiIcon name="seed" size={13} />
            {balance.toLocaleString()}
          </span>
          <button
            type="button"
            className="pip-key pip-key-small"
            disabled={busy}
            aria-disabled={refusal !== null || undefined}
            title={refusal ?? "A freeze covers one missed day, so the streak carries on"}
            onClick={() => (refusal ? setAskedWhy(true) : buy())}
          >
            {busy ? "…" : (
              <>
                Buy a freeze · <UiIcon name="seed" size={12} />
                {shop?.price ?? "–"}
              </>
            )}
          </button>
        </div>
      </div>
      {askedWhy && refusal && (
        <p className="-mt-2 text-right text-xs text-on-surface-variant" role="status">
          {refusal}
        </p>
      )}
      {error && <p className="rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>}

      <div className="flex items-center gap-2">
        {!snapshot.todayMet && (
          <button type="button" className="tactile-button tactile-button-primary flex-1 px-4 py-2.5 text-sm font-semibold" onClick={onRead}>
            {readLabel}
            {left > 0 && <span className="ml-1.5 font-normal opacity-80">· {left} min</span>}
          </button>
        )}
        <button
          type="button"
          className={`tactile-button px-3 py-2.5 text-sm font-semibold ${snapshot.todayMet ? "flex-1" : ""}`}
          onClick={onOpenCalendar}
          title="The month's calendar, in Social → Stats"
          aria-label="Calendar"
        >
          <CalendarDays size={16} aria-hidden />
          {snapshot.todayMet && <span className="ml-2">Calendar</span>}
        </button>
      </div>
    </div>
  );
};
