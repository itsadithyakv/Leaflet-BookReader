import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Check, Footprints, Info, ListChecks, Nut, Star, TreePine, Trees, X } from "lucide-react";
import { useBackLayer } from "../../../../platform/back";
import { playSound } from "../../../../pip/sound";
import { chipLine, ladderOf, tutorialRunning, type Brought } from "../../../../pip/base/ladder";
import type { BaseState, QuestAt } from "../../../../pip/base/rules";
import { Sprite } from "./Sprite";
import "./ladder.css";

/** A picture for a thing a level brings. */
const broughtPicture = (entry: Brought): ReactNode =>
  entry.kind === "ground" ? (
    <Trees size={15} aria-hidden />
  ) : entry.kind === "plot" ? (
    <Sprite name="workshop" variant={0} box={22} />
  ) : entry.kind === "decor" ? (
    <Sprite name="decor" variant={0} box={22} />
  ) : entry.kind === "meadow" ? (
    <TreePine size={15} aria-hidden />
  ) : entry.kind === "guards" ? (
    <Sprite name="guardian" variant={0} box={22} />
  ) : entry.kind === "work" ? (
    <Sprite name="work" variant={entry.which ?? 0} box={22} />
  ) : entry.kind === "foe" ? (
    <Footprints size={15} aria-hidden />
  ) : entry.kind === "fence" ? (
    <Sprite name="fencepiece" variant={1} box={22} />
  ) : entry.kind === "postcard" ? (
    <Camera size={15} aria-hidden />
  ) : (
    <Star size={15} aria-hidden />
  );

/** What a level brings: three named things at most, each its picture and its name. */
export const LevelBrings = ({ level, brings }: { level: number; brings: Brought[] }) =>
  brings.length === 0 ? null : (
    <span className="pip-ladder-brings" role="group" aria-label={`Level ${level} brings`}>
      <span className="pip-ladder-brings-at">Level {level} brings</span>
      {brings.map((entry) => (
        <span key={entry.name} className="pip-ladder-brought" title={entry.says}>
          <span className="pip-ladder-brought-picture" aria-hidden="true">
            {broughtPicture(entry)}
          </span>
          {entry.name}
        </span>
      ))}
    </span>
  );

type GoalLadderProps = {
  base: BaseState;
  minutes: number;
  /** More for the chip's tooltip: the season, the streak, what the book being read sends. */
  note?: string;
  /** Shows where a step is done. */
  onGo: (at: QuestAt) => void;
};

/**
 * The goal ladder: one chip in the camp's row of chips, "2/5 · Next: Lookout
 * +15" (the Hollow's level has a chip of its own since 1.5.8), and Pip's
 * list under it when it is tapped: the steps
 * that take the burrow to its next level, raising it last, why a step
 * cannot be done yet (in its (i)), and what that level brings. While Pip's
 * guided first session runs, the chip keeps quiet and does not open.
 * `data-welcome="goal"` is where the session points at it.
 */
export const GoalLadder = ({ base, minutes, note, onGo }: GoalLadderProps) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const quiet = tutorialRunning(base);
  const shown = open && !quiet;
  useBackLayer(shown, () => setOpen(false));
  // A tap anywhere else puts the list away.
  useEffect(() => {
    if (!shown) return undefined;
    const away = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [shown]);

  const ladder = ladderOf(base, minutes);
  const next = ladder.next;
  const reward = next && next.reward > 0 ? next.reward : 0;
  const title = [
    ladder.full && next ? `Done: ${next.quest.short}. Its ${reward} acorns wait for room in the larder.` : "Pip's list",
    note ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span ref={wrapRef} className="pip-ladder" data-welcome="goal">
      <button
        type="button"
        className={`pip-base-chip pip-ladder-chip ${ladder.full ? "is-bad" : ""} ${quiet ? "is-quiet" : ""}`}
        aria-expanded={shown}
        aria-label={chipLine(ladder) + (reward > 0 ? `, ${reward} acorns` : "")}
        title={title}
        tabIndex={quiet ? -1 : undefined}
        onClick={() => {
          if (quiet) return;
          playSound("click");
          setOpen((was) => !was);
        }}
      >
        <ListChecks size={13} aria-hidden />
        {next ? (
          <>
            <span className="pip-ladder-pips" aria-hidden="true">
              {ladder.steps.map((step) => (
                <span key={step.quest.id} className={`pip-ladder-pip ${step.state === "done" ? "is-done" : ""}`} />
              ))}
            </span>
            <span className="pip-ladder-count" aria-hidden="true">
              {ladder.done}/{ladder.total}
            </span>
            <span className="pip-ladder-next" aria-hidden="true">
              <span className="pip-ladder-next-word">Next: </span>
              <strong>{next.quest.short}</strong>
            </span>
            {reward > 0 && (
              <span className="pip-ladder-reward" aria-hidden="true">
                <Nut size={12} />+{reward}
              </span>
            )}
          </>
        ) : (
          <>
            <span aria-hidden="true">Pip's list</span>
            <Check size={13} aria-hidden />
          </>
        )}
      </button>
      {shown && (
        <span className="pip-ladder-card" role="dialog" aria-label="Pip's list">
          <span className="pip-ladder-head">
            <span className="pip-base-title">Pip's list</span>
            <span className="pip-ladder-to">{ladder.group?.to ? `Hollow level ${ladder.level} → ${ladder.group.to}` : `Hollow level ${ladder.level}`}</span>
            <button type="button" className="pip-ladder-close" aria-label="Close" onClick={() => setOpen(false)}>
              <X size={14} aria-hidden />
            </button>
          </span>
          {ladder.steps.length > 0 ? (
            <span className="pip-ladder-steps" role="list">
              {ladder.steps.map((step) => (
                <span key={step.quest.id} role="listitem" className={`pip-ladder-step is-${step.state} ${step.quest.raise ? "is-raise" : ""}`}>
                  <span className="pip-ladder-mark" aria-hidden="true">
                    {step.state === "done" ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  {step.state === "done" ? (
                    <span className="pip-ladder-text">{step.quest.text}</span>
                  ) : (
                    <button
                      type="button"
                      className="pip-ladder-text pip-ladder-go"
                      title={step.why ?? "Show me where"}
                      onClick={() => {
                        setOpen(false);
                        onGo(step.quest.at);
                      }}
                    >
                      {step.quest.text}
                    </button>
                  )}
                  {step.why && (
                    <span className="pip-ladder-why" role="img" aria-label={step.why} title={step.why}>
                      <Info size={12} aria-hidden />
                    </span>
                  )}
                  {step.reward > 0 && (
                    <span className="pip-ladder-step-reward">
                      <Nut size={11} aria-hidden />+{step.reward}
                      <span className="sr-only"> acorns</span>
                    </span>
                  )}
                </span>
              ))}
            </span>
          ) : (
            <span className="pip-ladder-empty">All done.</span>
          )}
          {ladder.group?.to ? <LevelBrings level={ladder.group.to} brings={ladder.brings} /> : null}
        </span>
      )}
    </span>
  );
};
