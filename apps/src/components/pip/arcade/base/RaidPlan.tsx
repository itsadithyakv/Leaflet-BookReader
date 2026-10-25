import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Hourglass, Minus, Plus, RotateCcw, Swords, Trash2, X } from "lucide-react";
import type { Approach } from "../../../../pip/base/approaches";
import type { ScoutKind, Setup, Squad, SquadGroup } from "../../../../pip/base/battle";
import { GROUPS_MOST, ROOM, checkSquad, roomOf, type PlanForecast, type SquadProblem } from "../../../../pip/base/squad";
import { playSound } from "../../../../pip/sound";
import { Sprite } from "./Sprite";
import { StarPips } from "./RaidScout";
import { APPROACH_COLOURS } from "./raidPaint";
import { KINDS, KIND_ART, KIND_NAMES, PROBLEM_WORDS, approachShort } from "./raidWords";

/**
 * Planning a raid (the Magpie Lands, 2026-10-24; raids-plan.md, section 2), on the scouted field: the squad as groups
 * within the hut's room (a sprout or a slinger one place, a mole or a Puffcap two), each sent down one of the camp's
 * approaches, one perhaps held back as the second wave, and the hero with one of them. It starts from the plan a
 * reader makes without thinking (`naiveSquad`), so "Go" can be pressed at once.
 *
 * A group goes down an approach by a tap on the path's tag (or its swatch here), or by dragging its chip onto a path.
 * What is wrong with the squad (`checkSquad`) is a small mark where it is wrong, its words behind a tooltip. The
 * forecast is coarse ("Likely ★★") and is worked out a moment after the plan stops changing, never as it changes, a run
 * at a time so a slow phone's page is never held for long.
 *
 * (2026-10-25) A card of Pip's pixel paper, as the Hollow's sheets are, never a form: each group a tab in its own
 * colour, each kind a tile with its picture (the field's own scouts, `KIND_ART`) and its count between two pixel keys.
 */

/** How long the plan has to be still before it is forecast again. */
export const FORECAST_WAIT_MS = 350;

type Props = {
  setup: Pick<Setup, "capacity" | "kinds" | "bombers" | "hero">;
  approaches: readonly Approach[];
  squad: Squad;
  onSquad: (squad: Squad) => void;
  /** The group being planned. */
  chosen: number;
  onChoose: (group: number) => void;
  /** The plan's forecast: costly (a few runs of it), so asked only once the plan is still, and worked a run at a time (`forecastInSteps`). */
  forecast: (squad: Squad) => () => PlanForecast | null;
  /** The squad as the planner began it, to go back to. */
  naive: Squad;
  heroName: string | null;
  /** Why it cannot set out now (no rest), or null. */
  blocked: string | null;
  /** A group's chip dropped at a point on the screen: onto a path, it goes down it. */
  onDrop: (group: number, clientX: number, clientY: number) => void;
  onGo: () => void;
  onBack: () => void;
  onClose: () => void;
};

const scoutsIn = (group: SquadGroup) => KINDS.reduce((sum, kind) => sum + Math.max(0, Math.floor(group.scouts[kind] ?? 0)), 0);

/** A group's own problems: nobody in it, or a kind the hut has not trained. */
const groupProblems = (group: SquadGroup, setup: Pick<Setup, "kinds">): SquadProblem[] => {
  const problems: SquadProblem[] = [];
  if (scoutsIn(group) === 0 && !group.hero) problems.push("empty");
  if (KINDS.some((kind) => (group.scouts[kind] ?? 0) > 0 && !setup.kinds.includes(kind))) problems.push("kind");
  return problems;
};

const Mark = ({ problem }: { problem: SquadProblem }) => (
  <span className="pip-raid-mark" role="img" aria-label={PROBLEM_WORDS[problem]} title={PROBLEM_WORDS[problem]} data-problem={problem}>
    !
  </span>
);

export const RaidPlan = (props: Props) => {
  const { setup, approaches, squad, chosen, onSquad, onChoose } = props;
  const problems = checkSquad(setup, squad, approaches.length);
  const room = roomOf(squad);
  const group = squad.groups[chosen] ?? squad.groups[0];
  const index = squad.groups[chosen] ? chosen : 0;

  // ---- the forecast, a moment after the plan stops changing
  const key = JSON.stringify(squad);
  const [band, setBand] = useState<PlanForecast | null>(null);
  const [waiting, setWaiting] = useState(true);
  const forecastRef = useRef(props.forecast);
  forecastRef.current = props.forecast;
  useEffect(() => {
    setWaiting(true);
    if (problems.length > 0) return;
    let timer = 0;
    const work = (step: () => PlanForecast | null) => {
      const said = step();
      if (said) {
        setBand(said);
        setWaiting(false);
      } else timer = window.setTimeout(() => work(step), 0);
    };
    timer = window.setTimeout(() => work(forecastRef.current(squad)), FORECAST_WAIT_MS);
    return () => window.clearTimeout(timer);
    // `squad` is what `key` says it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, problems.length]);

  const change = (at: number, next: SquadGroup | null) => {
    const groups = squad.groups.slice();
    if (next) groups[at] = next;
    else groups.splice(at, 1);
    onSquad({ groups });
  };
  const count = (kind: ScoutKind, by: number) => {
    if (!group) return;
    const now = Math.max(0, Math.floor(group.scouts[kind] ?? 0) + by);
    const scouts = { ...group.scouts, [kind]: now };
    if (now === 0) delete scouts[kind];
    change(index, { ...group, scouts });
    playSound("click", { pitch: by > 0 ? 1.1 : 0.9 });
  };
  const hold = () => {
    if (!group) return;
    // Only one group waits: holding this one sends the others in.
    onSquad({ groups: squad.groups.map((entry, at) => (at === index ? { ...entry, held: !entry.held } : entry.held ? { ...entry, held: false } : entry)) });
    playSound("click");
  };
  const heroHere = (at: number) => {
    onSquad({ groups: squad.groups.map((entry, k) => ({ ...entry, hero: k === at ? true : undefined })) });
    playSound("squeak");
  };
  const add = () => {
    if (squad.groups.length >= GROUPS_MOST) return;
    // A new group, empty, down the next way in.
    const via = (squad.groups[squad.groups.length - 1]?.approach ?? -1) + 1;
    onSquad({ groups: [...squad.groups, { scouts: {}, approach: via % Math.max(1, approaches.length) }] });
    onChoose(squad.groups.length);
    playSound("place");
  };

  // ---- a chip dragged onto a path
  const drag = useRef<{ group: number; x: number; y: number; moved: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ group: number; x: number; y: number } | null>(null);
  const down = (event: ReactPointerEvent, at: number) => {
    drag.current = { group: at, x: event.clientX, y: event.clientY, moved: false };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };
  const move = (event: ReactPointerEvent) => {
    const was = drag.current;
    if (!was) return;
    if (!was.moved && Math.hypot(event.clientX - was.x, event.clientY - was.y) < 6) return;
    was.moved = true;
    setGhost({ group: was.group, x: event.clientX, y: event.clientY });
  };
  const up = (event: ReactPointerEvent) => {
    const was = drag.current;
    drag.current = null;
    setGhost(null);
    if (was?.moved) props.onDrop(was.group, event.clientX, event.clientY);
  };

  const canGo = problems.length === 0 && props.blocked === null;
  const roomBad = problems.includes("room");
  return (
    <section className="pip-raid-panel pip-raid-plan" aria-label="The plan">
      <button type="button" className="pip-raid-key pip-raid-panel-close" aria-label="Back to the map" title="Back to the map" onClick={props.onClose}>
        <X size={15} aria-hidden />
      </button>
      <div className="pip-raid-plan-head">
        <button type="button" className="pip-raid-key" aria-label="Back to scouting" title="Back to scouting" onClick={props.onBack}>
          <ArrowLeft size={15} aria-hidden />
        </button>
        <span className={`pip-base-chip pip-raid-room${roomBad ? " is-bad" : ""}`} title={`Room in the hut's party: ${room} of ${setup.capacity}`} data-room={room}>
          <Sprite name="hut" variant={3} box={16} />
          <strong>{room}</strong>/{setup.capacity}
          {roomBad && <Mark problem="room" />}
          {problems.includes("bombers") && <Mark problem="bombers" />}
        </span>
        <button
          type="button"
          className="pip-raid-key"
          aria-label="Start the plan again"
          title="Start the plan again"
          onClick={() => {
            onSquad(props.naive);
            onChoose(0);
            playSound("click");
          }}
        >
          <RotateCcw size={14} aria-hidden />
        </button>
      </div>

      {/* The groups: a chip each, dragged onto a path to send it that way. */}
      <div className="pip-raid-groups" role="tablist" aria-label="Groups">
        {squad.groups.map((entry, at) => {
          const mine = groupProblems(entry, setup);
          const colour = APPROACH_COLOURS[entry.approach % APPROACH_COLOURS.length];
          return (
            <button
              key={at}
              type="button"
              role="tab"
              aria-selected={at === index}
              className={`pip-raid-group${at === index ? " is-chosen" : ""}${entry.held ? " is-held" : ""}`}
              style={{ "--group": colour } as CSSProperties}
              title={`${approachShort(approaches[entry.approach])}: ${scoutsIn(entry)} ${entry.held ? "(held back)" : ""}. Drag onto a path to send it that way.`}
              onClick={() => onChoose(at)}
              onPointerDown={(event) => down(event, at)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => {
                drag.current = null;
                setGhost(null);
              }}
            >
              <span>{approachShort(approaches[entry.approach])}</span>
              <strong className="pip-raid-group-count">{scoutsIn(entry)}</strong>
              {entry.held && <Hourglass size={11} aria-label="Held back" />}
              {entry.hero && props.heroName && <span className="sr-only">, with {props.heroName}</span>}
              {mine.map((problem) => (
                <Mark key={problem} problem={problem} />
              ))}
            </button>
          );
        })}
        {squad.groups.length < GROUPS_MOST && (
          <button type="button" className="pip-raid-key pip-raid-add" aria-label="Another group" title="Another group" onClick={add}>
            <Plus size={14} aria-hidden />
          </button>
        )}
      </div>

      {group && (
        <div className="pip-raid-group-edit" role="tabpanel" style={{ "--group": APPROACH_COLOURS[group.approach % APPROACH_COLOURS.length] } as CSSProperties}>
          {/* Which way in, and how the group goes (held back, with the hero): one row, so the card stays short. */}
          <div className="pip-raid-edit-row">
            <div className="pip-raid-ways" role="radiogroup" aria-label="Which way in">
              {approaches.map((approach, at) => (
                <button
                  key={at}
                  type="button"
                  role="radio"
                  aria-checked={group.approach === at}
                  className={`pip-raid-way${group.approach === at ? " is-chosen" : ""}`}
                  style={{ "--group": APPROACH_COLOURS[at % APPROACH_COLOURS.length] } as CSSProperties}
                  title={approach.name}
                  onClick={() => {
                    change(index, { ...group, approach: at });
                    playSound("click");
                  }}
                >
                  <i className="pip-raid-swatch" aria-hidden="true" />
                  {approachShort(approach)}
                </button>
              ))}
            </div>
            <div className="pip-raid-group-keys">
              <button type="button" className={`pip-base-chip pip-raid-toggle${group.held ? " is-on" : ""}`} aria-pressed={Boolean(group.held)} title="Held back as the second wave, until you release it" onClick={hold}>
                <Hourglass size={12} aria-hidden /> Wait
              </button>
              {props.heroName && (
                <button type="button" className={`pip-base-chip pip-raid-toggle${group.hero ? " is-on" : ""}`} aria-pressed={Boolean(group.hero)} title={`${props.heroName} goes with this group`} onClick={() => heroHere(index)}>
                  <Sprite name="hero" variant={setup.hero?.id ?? 0} box={16} /> {props.heroName}
                </button>
              )}
              {squad.groups.length > 1 && (
                <button
                  type="button"
                  className="pip-raid-key ml-auto"
                  aria-label="Take this group out"
                  title="Take this group out"
                  onClick={() => {
                    change(index, null);
                    onChoose(Math.max(0, index - 1));
                    playSound("pick");
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              )}
            </div>
          </div>
          <ul className="pip-raid-kinds">
            {KINDS.filter((kind) => setup.kinds.includes(kind) || (group.scouts[kind] ?? 0) > 0).map((kind) => {
              const n = group.scouts[kind] ?? 0;
              return (
                <li key={kind} className={`pip-raid-kind${n > 0 ? " is-in" : ""}`} title={`${KIND_NAMES[kind]}: ${ROOM[kind]} ${ROOM[kind] === 1 ? "place" : "places"} each`} data-kind={kind}>
                  <span className="pip-raid-kind-pic">
                    <Sprite name={KIND_ART[kind].name} variant={KIND_ART[kind].variant} box={32} />
                    {ROOM[kind] > 1 && (
                      <span className="pip-raid-room-each" aria-hidden="true">
                        ×{ROOM[kind]}
                      </span>
                    )}
                  </span>
                  <span className="pip-raid-kind-name">{KIND_NAMES[kind]}</span>
                  <span className="pip-raid-stepper">
                    <button type="button" className="pip-raid-step" aria-label={`One ${KIND_NAMES[kind].toLowerCase()} fewer`} disabled={n <= 0} onClick={() => count(kind, -1)}>
                      <Minus size={13} aria-hidden />
                    </button>
                    <strong className="pip-raid-count" aria-label={`${n} ${KIND_NAMES[kind].toLowerCase()}`}>
                      {n}
                    </strong>
                    <button type="button" className="pip-raid-step" aria-label={`One ${KIND_NAMES[kind].toLowerCase()} more`} onClick={() => count(kind, 1)}>
                      <Plus size={13} aria-hidden />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="pip-raid-go">
        <p className={`pip-raid-likely${waiting ? " is-waiting" : ""}`} aria-live="polite" data-likely={band && !waiting ? band.likely : ""}>
          {problems.length > 0 ? (
            problems.filter((problem) => problem !== "room" && problem !== "bombers").map((problem) => <Mark key={problem} problem={problem} />)
          ) : band ? (
            <>
              <span>Likely</span>
              <StarPips count={band.likely} />
              {band.low !== band.high && (
                <span className="pip-raid-band" title={`Between ${band.low} and ${band.high} stars, as it can go`}>
                  {band.low}–{band.high}
                </span>
              )}
            </>
          ) : (
            <span>…</span>
          )}
        </p>
        <button
          type="button"
          className="tactile-button tactile-button-primary flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold disabled:opacity-60"
          disabled={!canGo}
          title={props.blocked ?? (problems.length > 0 ? problems.map((problem) => PROBLEM_WORDS[problem]).join(". ") : "The scouts set out: this spends a raid's rest")}
          onClick={props.onGo}
        >
          <Swords size={14} aria-hidden /> Go
        </button>
      </div>
      {ghost && (
        <span className="pip-raid-ghost" style={{ left: ghost.x, top: ghost.y, "--group": APPROACH_COLOURS[(squad.groups[ghost.group]?.approach ?? 0) % APPROACH_COLOURS.length] } as CSSProperties} aria-hidden="true">
          <i className="pip-raid-swatch" />
          {scoutsIn(squad.groups[ghost.group] ?? { scouts: {}, approach: 0 })}
        </span>
      )}
    </section>
  );
};
