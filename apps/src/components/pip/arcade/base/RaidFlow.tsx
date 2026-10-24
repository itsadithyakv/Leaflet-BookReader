import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BrickWall } from "lucide-react";
import { Battle, type Result, type Squad } from "../../../../pip/base/battle";
import { FEATS } from "../../../../pip/base/feats";
import { CHAMPIONS, HEROES } from "../../../../pip/base/heroes";
import { REGION_NAMES, FAR_NAME, regionOf, strongholdName, type LandsTarget } from "../../../../pip/base/lands";
import { QUIRKS } from "../../../../pip/base/quirks";
import { starsOf } from "../../../../pip/base/raidMark";
import { forecastPlan, naiveSquad } from "../../../../pip/base/squad";
import {
  friendBlocked,
  friendRaidOf,
  monthName,
  monthOf,
  planFor,
  raidBlocked,
  raidSetup,
  type BaseState,
  type FriendRaid,
  type Now,
  type Raid,
  type RaidBlocked,
  type RaidEnd,
  type RaidPlan
} from "../../../../pip/base/rules";
import type { RaidTarget } from "../../../../services/socialService";
import { playSound } from "../../../../pip/sound";
import { currentTier } from "../../../../platform/perfTier";
import { useBackLayer } from "../../../../platform/back";
import type { GameArt } from "../gameArt";
import { screenRatio } from "./fit";
import { RaidBattle } from "./RaidBattle";
import { RaidEndCard } from "./RaidEndCard";
import { RaidField } from "./RaidField";
import { approachShort } from "./raidWords";
import { RaidPlan as PlanPanel } from "./RaidPlan";
import { QuirkIcon, RaidScout } from "./RaidScout";
import { newFx } from "./raidFx";
import { fieldView, fieldViewBeside, offPath, roomToField, tagPoint, toRoom, type Clear, type FieldView } from "./raidLayout";
import { APPROACH_COLOURS, newLooks, type RaidScene } from "./raidPaint";
import { Sprite } from "./Sprite";
import "./raid.css";

/**
 * A raid, from the map to its end (the Magpie Lands, 2026-10-24; raids-plan.md, sections 2, 3 and 5), filling the
 * camp's whole picture as the camp does, under the camp's own bar along the top:
 *
 * 1. **Scout**: the stronghold whole, free (`RaidScout`). Looking marks it scouted, so the map shows its quirk.
 * 2. **Plan**: the squad, on the same field (`RaidPlan`).
 * 3. **Go** spends the rest (`onStart`), and the **fight** plays on the field (`RaidBattle`).
 * 4. The **end card** (`RaidEndCard`): "Try again" (with rest) back to the plan, or back to the map.
 *
 * A friend's camp goes the same way, its approaches from its own layout. A raid sent without the reader opens here on
 * its end card, over the scouted field.
 */

export type RaidAim = { kind: "stronghold"; target: LandsTarget } | { kind: "friend"; target: RaidTarget };

type Step = "scout" | "plan" | "battle" | "end";

type Props = {
  base: BaseState;
  now: Now;
  art: GameArt;
  season: number;
  aim: RaidAim;
  /** Opened on a raid sent without the reader: its end card. */
  sent?: RaidEnd | null;
  why: (blocked: RaidBlocked, plan: RaidPlan) => string;
  onScouted: (n: number) => void;
  /** Sets out: spends the rest. Null when it cannot. */
  onStart: (aim: RaidAim, squad: Squad) => Raid | FriendRaid | null;
  onFinish: (raid: Raid | FriendRaid, result: Result) => RaidEnd | null;
  onLoot: (from: Element, loot: number) => void;
  /** Back to the map. */
  onClose: () => void;
  /** The plan's forecast (`squad.ts`); a test may count how often it is asked. */
  forecast?: typeof forecastPlan;
};

const stillOnly = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches || currentTier() === "minimal";
  } catch {
    return currentTier() === "minimal";
  }
};

/** The page's room for the raid, and how much of it the camp's bar along the top lies over. */
const measure = (element: HTMLElement | null) => {
  const w = element?.clientWidth || 960;
  const h = element?.clientHeight || 540;
  const root = element?.closest?.(".pip-base") as HTMLElement | null;
  const over = root?.getAttribute("data-mode") === "stage";
  const box = element?.getBoundingClientRect?.();
  const head = over ? root?.querySelector(".pip-base-stats")?.getBoundingClientRect?.() : null;
  const top = box && head ? Math.max(0, Math.round(head.bottom - box.top)) : 0;
  return { w, h, top };
};

/** The planner's tag for each approach, over its path: its colour, its name, walled, its hazard. */
const ApproachTags = ({ battle, view, plan, groups, short, onPick }: { battle: Battle; view: FieldView; plan: boolean; groups: number[]; short: boolean; onPick: (approach: number) => void }) => (
  <>
    {battle.approaches.map((approach, index) => {
      const at = tagPoint(approach.path, index);
      const spot = toRoom(view, at.x, at.y);
      const style = { left: spot.left, top: spot.top, "--group": APPROACH_COLOURS[index % APPROACH_COLOURS.length] } as CSSProperties;
      const going = groups.filter((via) => via === index).length;
      const inner = (
        <>
          <i className="pip-raid-swatch" aria-hidden="true" />
          <span className="pip-raid-tag-name">{short ? approachShort(approach) : approach.name}</span>
          {approach.walled && <BrickWall size={11} aria-label="walled" />}
          {approach.hazard && <QuirkIcon quirk={approach.hazard} box={14} />}
          {plan && going > 0 && <strong className="pip-raid-tag-count">{going}</strong>}
        </>
      );
      return plan ? (
        <button
          key={index}
          type="button"
          className="pip-raid-tag is-target"
          data-approach={index}
          style={style}
          title={`${approach.name}${approach.hazard ? `: ${QUIRKS[approach.hazard].name.toLowerCase()}` : ""}`}
          aria-label={`Send the group ${approach.name.replace(/^The /, "down the ")}`}
          onClick={() => onPick(index)}
        >
          {inner}
        </button>
      ) : (
        <span key={index} className="pip-raid-tag" style={style} title={approach.hazard ? QUIRKS[approach.hazard].name : undefined}>
          {inner}
        </span>
      );
    })}
  </>
);

export const RaidFlow = (props: Props) => {
  const { base, now, art, season } = props;
  const still = useMemo(() => stillOnly(), []);
  const [aim, setAim] = useState<RaidAim>(props.aim);
  const [step, setStep] = useState<Step>(props.sent ? "end" : "scout");
  const [end, setEnd] = useState<RaidEnd | null>(props.sent ?? null);
  const [fight, setFight] = useState<{ raid: Raid | FriendRaid; battle: Battle } | null>(null);

  // ---- what is raided, as it would set out now (nothing spent)
  const shape = `${base.levels.hut}|${base.hero}|${base.forks.hut}|${base.camps}`;
  const preview = useMemo(() => {
    if (aim.kind === "friend") {
      const raid = friendRaidOf(base, aim.target.camp, { handle: aim.target.handle, name: aim.target.name }, now);
      return { plan: raid.plan, setup: raid.setup, structures: raid.structures as typeof raid.structures | undefined };
    }
    const plan = planFor(base, aim.target.kind, now.day, aim.target.slot);
    return { plan, setup: raidSetup(base, plan, undefined, now.at), structures: undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aim, shape, now.day]);
  const { plan } = preview;
  /** The stronghold this raid set out for: once it falls, the next stronghold is the map's next, and this one a replay. */
  const [aimedN] = useState(plan.n);
  const stronghold = aim.kind === "stronghold" && (aim.target.kind === "camp" || aim.target.kind === "rematch");
  const king = plan.kind === "king";
  const scoutBattle = useMemo(() => new Battle({ ...preview.setup, squad: { groups: [] } }, preview.structures), [preview]);
  const [squad, setSquad] = useState<Squad>(() => naiveSquad(preview.setup));
  const [chosen, setChosen] = useState(0);

  // Scouting marks the stronghold: the map shows its quirk from now on.
  const scoutedN = stronghold && step === "scout" ? plan.n : null;
  useEffect(() => {
    if (scoutedN !== null) props.onScouted(scoutedN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoutedN]);

  // ---- the room, and the field in it
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sideRef = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState({ w: 960, h: 540, top: 0, sideW: 0, sideH: 0 });
  useLayoutEffect(() => {
    const element = rootRef.current;
    const look = () =>
      setRoom((was) => {
        const next = { ...measure(element), sideW: sideRef.current?.offsetWidth ?? 0, sideH: sideRef.current?.offsetHeight ?? 0 };
        return was.w === next.w && was.h === next.h && was.top === next.top && was.sideW === next.sideW && was.sideH === next.sideH ? was : next;
      });
    look();
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(look);
    observer.observe(element);
    if (sideRef.current) observer.observe(sideRef.current);
    return () => observer.disconnect();
  }, [step]);
  // Where the raid is a block of a page that scrolls (a small window, a phone upright), it is brought up under the
  // app's bar at each step, so the bar along its top is in view.
  useEffect(() => {
    const element = rootRef.current;
    if (!element || element.closest?.(".pip-base")?.getAttribute("data-mode") === "stage") return;
    element.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [step, still]);
  const tall = room.h > room.w * 1.15;
  /** A short room (a phone on its side): the card keeps to the few things that matter, the tags to a word. */
  const short = !tall && room.h < 420;
  const side = step === "scout" || step === "plan";
  const clear: Clear = side
    ? tall
      ? { top: room.top + 6, right: 6, bottom: room.sideH + 14, left: 6 }
      : { top: room.top + 8, right: room.sideW + 24, bottom: 8, left: 8 }
    : short
      ? { top: room.top + 4, right: 4, bottom: 4, left: 4 }
      : { top: room.top + 30, right: 8, bottom: step === "battle" ? 50 : 8, left: 8 };
  // Beside the card the field may run a little under it, where nothing stands, to be a whole size larger.
  const view = side ? fieldViewBeside(room.w, room.h, screenRatio(), clear, tall ? 36 : 32) : fieldView(room.w, room.h, screenRatio(), clear);
  // The fight keeps the field where it was laid out for it when the end card comes up over it.
  // (In a short room the bar and the orders lie over the field's far corner, where nothing stands: raid.css.)
  const battleView = fieldView(room.w, room.h, screenRatio(), short ? { top: room.top + 4, right: 4, bottom: 4, left: 4 } : { top: room.top + 30, right: 8, bottom: 50, left: 8 });

  // ---- why it cannot set out (no rest), for Go and "Try again"
  const blocked = (target: RaidAim): string | null => {
    if (target.kind === "friend") {
      const why = target.target.raidedToday ? "today" : friendBlocked(base, now, target.target.handle);
      return why === "today" ? "Raided today. More tomorrow." : why === "rest" ? "The scouts are resting" : why ? "Not now" : null;
    }
    const why = raidBlocked(base, target.target.kind, now, target.target.slot);
    return why ? props.why(why, planFor(base, target.target.kind, now.day, target.target.slot)) : null;
  };

  const forecast = props.forecast ?? forecastPlan;
  const go = () => {
    const begun = props.onStart(aim, squad);
    if (!begun) {
      playSound("click", { pitch: 0.6 });
      return;
    }
    playSound("horn");
    setFight({ raid: begun, battle: new Battle(begun.setup, (begun as FriendRaid).structures) });
    setStep("battle");
  };
  const done = (result: Result) => {
    if (!fight) return;
    setEnd(props.onFinish(fight.raid, result));
    setStep("end");
  };
  // Again: the stronghold just taken is a replay now; anything else is raided as it was.
  const again: RaidAim | null =
    aim.kind === "friend" ? null : aim.target.kind === "camp" && base.camps > aimedN ? { kind: "stronghold", target: { kind: "rematch", slot: aimedN } } : aim;
  const againWhy = again ? blocked(again) : "Raided today. More tomorrow.";

  // Back: from the scout, the plan or the end card, to the map. (A fight's own Back ends it as it stands.)
  useBackLayer(step !== "battle", props.onClose);

  // ---- the plan's drag: a group dropped on a path goes down it
  const dropAt = (group: number, clientX: number, clientY: number) => {
    const hit = typeof document.elementFromPoint === "function" ? document.elementFromPoint(clientX, clientY) : null;
    const tag = hit?.closest?.("[data-approach]");
    let approach = tag ? Number(tag.getAttribute("data-approach")) : -1;
    if (approach < 0) {
      const box = rootRef.current?.getBoundingClientRect();
      const at = box ? roomToField(view, clientX - box.left, clientY - box.top) : null;
      if (at) {
        let best = 18;
        scoutBattle.approaches.forEach((entry, index) => {
          const off = offPath(entry.path, at.x, at.y);
          if (off < best) {
            best = off;
            approach = index;
          }
        });
      }
    }
    if (approach < 0 || !squad.groups[group]) return;
    setSquad({ groups: squad.groups.map((entry, index) => (index === group ? { ...entry, approach } : entry)) });
    setChosen(group);
    playSound("place");
  };

  // ---- the stronghold's card
  const region = aim.kind === "friend" ? plan.tier : regionOf(plan.n);
  const title = aim.kind === "friend" ? plan.name : king ? "The Magpie King" : strongholdName(plan.n);
  const sub = aim.kind === "friend" ? "A friend's camp" : king ? `${monthName(monthOf(now.day))}'s roost` : `${plan.n >= 15 ? FAR_NAME : REGION_NAMES[regionOf(plan.n)]} · Stronghold ${plan.n + 1}`;
  const picture =
    aim.kind === "friend" ? (
      <Sprite name="burrow" variant={Math.max(1, Math.min(5, aim.target.camp.levels.burrow ?? 1))} box={44} />
    ) : king ? (
      <Sprite name="landroost" variant={1} box={44} />
    ) : (
      <Sprite name={plan.champion !== null ? "landkeep" : "landnode"} variant={Math.min(5, regionOf(plan.n))} box={44} />
    );
  const heroName = preview.setup.hero ? (HEROES[preview.setup.hero.id]?.short ?? "The hero") : null;

  const scene: RaidScene = useMemo(
    () => ({ battle: scoutBattle, art, fx: newFx(true), region, season, marks: { reach: true, chosen: null, targets: [] } }),
    [scoutBattle, art, region, season]
  );
  const looks = useMemo(() => newLooks(scoutBattle), [scoutBattle]);
  const chosenVia = step === "plan" ? (squad.groups[chosen]?.approach ?? null) : null;
  const shownScene: RaidScene = { ...scene, marks: { reach: step !== "end", chosen: chosenVia, targets: [] } };

  return (
    <div ref={rootRef} className="pip-raid" data-orient={view.orient} data-short={short ? "" : undefined} data-step={step} style={{ "--raid-top": `${room.top}px` } as CSSProperties}>
      {fight && (step === "battle" || step === "end") ? (
        <RaidBattle battle={fight.battle} art={art} view={battleView} region={region} season={season} name={title} still={still} onDone={done} />
      ) : (
        <RaidField view={view} scene={shownScene} looks={looks} paintKey={`${step}|${chosenVia}`} label={`${title}, scouted`}>
          {step !== "end" && (
            <ApproachTags
              battle={scoutBattle}
              view={view}
              plan={step === "plan"}
              short={tall || short}
              groups={squad.groups.map((entry) => entry.approach)}
              onPick={(approach) => {
                if (!squad.groups[chosen]) return;
                setSquad({ groups: squad.groups.map((entry, index) => (index === chosen ? { ...entry, approach } : entry)) });
                playSound("place");
              }}
            />
          )}
        </RaidField>
      )}

      {side && (
        <div ref={sideRef} className="pip-raid-side">
          {step === "scout" ? (
            <RaidScout
              name={title}
              sub={sub}
              picture={picture}
              quirk={scoutBattle.quirk}
              featWords={FEATS[scoutBattle.feat ?? "whole"]}
              champion={plan.champion !== null ? { name: CHAMPIONS[plan.champion] ?? "", variant: plan.champion } : null}
              best={aim.kind === "stronghold" && aim.target.kind === "rematch" && starsOf(base.strongholds, plan.n) > 0 ? starsOf(base.strongholds, plan.n) : null}
              need={plan.need}
              onPlan={() => {
                setStep("plan");
                playSound("click");
              }}
              onClose={props.onClose}
            />
          ) : (
            <PlanPanel
              setup={preview.setup}
              approaches={scoutBattle.approaches}
              squad={squad}
              onSquad={setSquad}
              chosen={chosen}
              onChoose={setChosen}
              forecast={(next) => forecast({ ...preview.setup, squad: next, ...(aim.kind === "friend" ? { quirk: null } : {}) }, preview.structures)}
              naive={naiveSquad(preview.setup)}
              heroName={heroName}
              blocked={blocked(aim)}
              onDrop={dropAt}
              onGo={go}
              onBack={() => setStep("scout")}
              onClose={props.onClose}
            />
          )}
        </div>
      )}

      {step === "end" && end && (
        <div className="pip-raid-end-wrap">
          <RaidEndCard
            end={end}
            friend={aim.kind === "friend"}
            onAgain={
              again && againWhy === null
                ? () => {
                    setAim(again);
                    setFight(null);
                    setEnd(null);
                    setStep("plan");
                  }
                : null
            }
            againWhy={againWhy}
            onMap={props.onClose}
            onLoot={props.onLoot}
          />
        </div>
      )}
    </div>
  );
};
