import type { CSSProperties } from "react";
import { FlameSprite, IceCube } from "./sprites";
import type { DayBubble, FlameState } from "./streakModel";

/** Sparks flying out from the middle: `count` of them evenly round, `reach` px out. */
export const Burst = ({ count = 8, reach = 26, big = false }: { count?: number; reach?: number; big?: boolean }) => {
  const colours = ["var(--flame-a)", "var(--flame-r)", "var(--flame-y)", "var(--ice-i)"];
  return (
    <span className="streak-burst" aria-hidden="true">
      {Array.from({ length: count }, (_, at) => {
        const angle = (at / count) * Math.PI * 2 - Math.PI / 2;
        // Every other spark a little further, so a ring reads as a burst.
        const far = reach * (at % 2 === 0 ? 1 : 0.7) * (big ? 1 + (at % 3) * 0.25 : 1);
        const style = {
          "--dx": `${Math.round(Math.cos(angle) * far)}px`,
          "--dy": `${Math.round(Math.sin(angle) * far + (big ? 10 : 0))}px`,
          "--c": colours[at % (big ? 4 : 3)],
          "--r": big ? `${(at % 2 === 0 ? 1 : -1) * 180}deg` : "0deg",
          "--t": big ? "1150ms" : "700ms",
          "--d": `${(big ? 80 : 160) + (at % 3) * 40}ms`
        } as CSSProperties;
        return <i key={at} style={style} />;
      })}
    </span>
  );
};

/** A number that rolls over from `from` to `to` once, as it mounts. */
export const TickCount = ({ from, to }: { from: number; to: number }) =>
  from === to ? (
    <>{to}</>
  ) : (
    <span className="streak-tick streak-anim" aria-label={String(to)}>
      <span aria-hidden="true">
        <span>{from}</span>
        <span>{to}</span>
      </span>
    </span>
  );

const BUBBLE_TITLE: Record<DayBubble["kind"], string> = {
  met: "Goal met",
  frozen: "Saved by a freeze",
  grace: "Grace day: one missed day a streak forgives",
  today: "Today",
  missed: "Missed",
  future: ""
};

/** One day of the week: lit, ice, grace, today's ring, empty. */
export const DayBubbleView = ({ day, flame }: { day: DayBubble; flame: FlameState }) => {
  const ring = 2 * Math.PI * 19;
  const when = new Date(`${day.dateKey}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });
  const title = day.kind === "future" ? when : `${when}: ${BUBBLE_TITLE[day.kind]}${day.minutes > 0 ? ` · ${Math.round(day.minutes)} min` : ""}`;
  return (
    <div className="streak-day" data-today={day.kind === "today" || undefined} title={title}>
      <span className="streak-bubble" data-kind={day.kind}>
        {day.kind === "met" && <FlameSprite state="lit" scale={2} />}
        {day.kind === "frozen" && <IceCube scale={2} />}
        {day.kind === "grace" && <FlameSprite state="lit" scale={2} className="streak-flame-ghost" />}
        {day.kind === "today" && (
          <>
            <svg className="streak-ring" viewBox="0 0 42 42" aria-hidden="true">
              <circle className="streak-ring-track" cx="21" cy="21" r="19" />
              <circle className="streak-ring-fill" cx="21" cy="21" r="19" strokeDasharray={`${day.progress * ring} ${ring}`} />
            </svg>
            <FlameSprite state={flame === "lit" ? "lit" : flame} scale={2} />
          </>
        )}
      </span>
      {day.letter}
    </div>
  );
};

/** A small pixel shield, for "saved". */
export const Shield = () => (
  <svg className="streak-shield" width="20" height="22" viewBox="0 0 10 11" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M1 0h8v1h1v5h-1v2h-1v1h-1v1h-1v1h-2v-1h-1v-1h-1v-1h-1v-2h-1v-5h1z" fill="var(--ice-o)" />
    <path d="M2 1h6v5h-1v2h-1v1h-2v-1h-1v-2h-1z" fill="var(--ice-i)" />
    <path d="M3 2h2v1h-1v2h-1z" fill="var(--ice-w)" />
  </svg>
);
