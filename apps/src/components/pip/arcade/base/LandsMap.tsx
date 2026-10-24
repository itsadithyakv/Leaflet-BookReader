import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Hammer, Info, Moon, Send, Shield, Star, Swords, UserX, X } from "lucide-react";
import {
  monthName,
  monthOf,
  naivePlanOf,
  nextCamp,
  raidBlocked,
  raidForecast,
  rematchOf,
  replayLoot,
  roadCamp,
  seasonOf,
  theKing,
  type BaseState,
  type Now,
  type RaidBlocked,
  type RaidEnd,
  type RaidPlan
} from "../../../../pip/base/rules";
import { HEROES, CHAMPIONS } from "../../../../pip/base/heroes";
import { FAR_NAME, KING_TARGET, REGION_NAMES, landsOf, raidOf, roadTarget, type Lands, type LandsNode, type LandsTarget } from "../../../../pip/base/lands";
import { QUIRKS, quirkOf as quirkAt } from "../../../../pip/base/quirks";
import type { RaidTarget } from "../../../../services/socialService";
import { currentTier } from "../../../../platform/perfTier";
import { playSound } from "../../../../pip/sound";
import { runScene } from "../frameGate";
import type { GameArt } from "../gameArt";
import { screenRatio } from "./fit";
import { Sprite } from "./Sprite";
import { raidWords } from "./hollowRules";
import { landKey, paintLand, paintMoving } from "./landsPaint";
import { ROOST_ACROSS, ROOST_ALONG, SIGN_ACROSS, SIGN_ALONG, frontierAlong, nodeAlong, pointAt, regionFrom, roadAt, scrollFor, viewFor, type LandsView } from "./landsLayout";

/**
 * The Magpie Lands (raids rethought, 2026-10-24): what the raid key opens. The whole page is the map, as the camp is
 * the picture: a winding path from Pip's camp through the five regions to the King's peak and on into the Far
 * Rookeries, scrolled along where it is longer than the screen, Pip standing at the next stronghold. A tap on a
 * stronghold opens its card: its best stars, its quirk once scouted, and Raid (or Replay, for one taken). Everything
 * the raid board had is here: the King, the day's camps on the road, the friends' signpost, the hero who goes, the
 * scouts' hut, what the last Send brought.
 *
 * Starting a raid is one call, `onRaid({ kind, slot })`: the raid's own screens (RaidFlow.tsx: scout, plan, fight)
 * take over from it without the map knowing.
 */

type Chosen = { what: "node"; n: number } | { what: "roost" } | { what: "road"; slot: number } | { what: "friends" } | { what: "totals" } | { what: "fog"; region: number } | null;

export type LandsMapProps = {
  base: BaseState;
  now: Now;
  art: GameArt;
  /** Raids' rest in hand, and the minutes of reading to the next. */
  rested: number;
  restIn: number;
  why: (blocked: RaidBlocked, plan: RaidPlan) => string;
  /** What the last "Send" brought, until another raid. */
  sent: RaidEnd | null;
  /** Starts a raid: the battle takes it from here. */
  onRaid: (target: LandsTarget) => void;
  /** Sends the scouts without the reader. */
  onSend: (target: LandsTarget, from: Element) => void;
  onHut: () => void;
  /** Back to the camp. */
  onClose: () => void;
  heroes: { here: (id: number) => boolean; asleep: (id: number) => boolean; onChoose: (id: number | null) => void };
  friends: {
    asked: boolean;
    mayRaid: boolean;
    onMayRaid: (on: boolean) => void;
    targets: RaidTarget[] | null;
    blocked: (target: RaidTarget) => string | null;
    onRaid: (target: RaidTarget) => void;
    scouts: number;
  } | null;
  /** A stronghold's quirk by its number, asked only of one scouted; the battle's own (`quirks.ts`) when not said. */
  quirkOf?: (n: number) => string | null;
};

/** A stronghold's quirk, by name (the battle's rules, `quirks.ts`): the map shows it once the stronghold is scouted. */
const quirkName = (n: number) => {
  const quirk = quirkAt(n, false);
  return quirk ? QUIRKS[quirk].name : null;
};

const stillOnly = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches || currentTier() === "minimal";
  } catch {
    return currentTier() === "minimal";
  }
};

/** Three star pips: `count` of them won. */
const Pips = ({ count, size = "map" }: { count: number; size?: "map" | "card" }) => (
  <span className={`pip-lands-stars is-${size}`} aria-label={`${count} of 3 stars`} role="img">
    {[0, 1, 2].map((index) => (
      <i key={index} className={index < count ? "is-won" : ""} aria-hidden="true" />
    ))}
  </span>
);

const acornsOf = (count: number) => (
  <span className="pip-base-acorns">
    <Sprite name="acorn" box={14} />
    {count}
    <span className="sr-only"> acorns</span>
  </span>
);

/** A stronghold's words for a screen reader: its name, and how it stands. */
const nodeLabel = (node: LandsNode) =>
  node.fogged ? `${node.name}, under fog` : node.next ? `${node.name}, the next stronghold` : node.taken ? (node.stars === null ? `${node.name}, taken` : `${node.name}, ${node.stars} of 3 stars`) : node.name;

/** The page's room for the map, and how much of it the bar along the top and the keys at the foot lie over. */
const measure = (element: HTMLElement | null) => {
  const w = element?.clientWidth || 960;
  const h = element?.clientHeight || 540;
  const root = element?.closest?.(".pip-base") as HTMLElement | null;
  const over = root?.getAttribute("data-mode") === "stage";
  const box = element?.getBoundingClientRect?.();
  const head = over ? root?.querySelector(".pip-base-stats")?.getBoundingClientRect?.() : null;
  const dock = over ? root?.querySelector(".pip-base-under")?.getBoundingClientRect?.() : null;
  const top = box && head ? Math.max(0, head.bottom - box.top) : 0;
  const bottom = box && dock ? Math.max(0, box.bottom - dock.top) : 0;
  // The line along the top (the progress) sits under the bar: kept clear too.
  return { w, h, clear: { top: top + 40, bottom: bottom + 6 } };
};

export const LandsMap = (props: LandsMapProps) => {
  const { base, now, art, friends } = props;
  const signShown = friends !== null && (friends.mayRaid || !friends.asked);
  const quirkOf = props.quirkOf ?? quirkName;
  const lands = useMemo(() => landsOf(base, now, { friends: signShown, quirkOf }), [base, now.minutes, now.day, signShown, quirkOf]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const landRef = useRef<HTMLCanvasElement | null>(null);
  const movingRef = useRef<HTMLCanvasElement | null>(null);
  const [room, setRoom] = useState(() => ({ w: 960, h: 540, clear: { top: 40, bottom: 6 } }));
  const [chosen, setChosen] = useState<Chosen>(null);
  const view = useMemo(() => viewFor(room.w, room.h, screenRatio(), room.clear), [room]);

  // ---- the room for it, as the page is laid out (and again when it changes)
  useLayoutEffect(() => {
    const element = rootRef.current;
    const look = () =>
      setRoom((was) => {
        const next = measure(element);
        return was.w === next.w && was.h === next.h && was.clear.top === next.clear.top && was.clear.bottom === next.clear.bottom ? was : next;
      });
    look();
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(look);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ---- scrolled to the next stronghold when the map is laid out anew, or the frontier moves on
  const frontier = frontierAlong(lands);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const to = scrollFor(view, lands);
    scroller.scrollLeft = to.left;
    scroller.scrollTop = to.top;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, frontier]);

  // ---- the land, painted when something on it changes
  const key = landKey(view, lands, base.levels.burrow, now.day);
  useEffect(() => {
    if (landRef.current) paintLand(landRef.current, view, lands, art, { campLevel: base.levels.burrow, sign: signShown });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, art]);

  // ---- what moves on it, painted only when it takes a step (and once, still, where motion is kept still)
  useEffect(() => {
    const canvas = movingRef.current;
    if (!canvas || !canvas.getContext?.("2d")) return;
    if (stillOnly() || typeof requestAnimationFrame === "undefined") {
      paintMoving(canvas, view, lands, art, 0, true);
      return;
    }
    const loop = runScene(canvas, (time) => paintMoving(canvas, view, lands, art, time, false) ?? undefined);
    return () => loop.stop();
  }, [view, lands, art]);

  // ---- a wheel turned over a wide map goes along it; a mouse drags it about
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || view.orient !== "wide") return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.ctrlKey) return;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY;
    };
    scroller.addEventListener("wheel", wheel, { passive: false });
    return () => scroller.removeEventListener("wheel", wheel);
  }, [view.orient]);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (chosen) setChosen(null);
      else props.onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [chosen]);

  const choose = (next: Chosen) => {
    if (dragged.current) return;
    setChosen(next);
    playSound("click");
  };

  const at = (u: number, v = 0) => {
    const p = pointAt(view, u, v);
    return { left: p.x * view.css, top: p.y * view.css };
  };
  const nodeBox = (node: LandsNode) => (node.kind === "keep" ? { w: 26, h: 28 } : { w: 20, h: 18 });

  return (
    <div
      ref={rootRef}
      className="pip-lands"
      data-orient={view.orient}
      role="region"
      aria-label="The Magpie Lands"
      // What lies over the map (the bar along the top, the keys at the foot): the line and the card keep clear of it.
      style={{ "--lands-top": `${Math.max(0, room.clear.top - 40)}px`, "--lands-bottom": `${room.clear.bottom}px`, "--lands-px": `${view.css}px` } as CSSProperties}
    >
      <div
        ref={scrollRef}
        className="pip-lands-scroll"
        onPointerDown={(event) => {
          dragged.current = false;
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          const scroller = scrollRef.current;
          drag.current = { x: event.clientX, y: event.clientY, left: scroller?.scrollLeft ?? 0, top: scroller?.scrollTop ?? 0, moved: false };
        }}
        onPointerMove={(event) => {
          const was = drag.current;
          const scroller = scrollRef.current;
          if (!was || !scroller) return;
          const dx = event.clientX - was.x;
          const dy = event.clientY - was.y;
          if (!was.moved && Math.hypot(dx, dy) < 5) return;
          was.moved = true;
          dragged.current = true;
          scroller.scrollLeft = was.left - dx;
          scroller.scrollTop = was.top - dy;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
      >
        <div className="pip-lands-world" style={{ width: view.world.w * view.css, height: view.world.h * view.css }}>
          <canvas ref={landRef} className="pip-sprite pip-lands-canvas" width={view.world.w} height={view.world.h} style={{ width: view.world.w * view.css, height: view.world.h * view.css }} aria-hidden="true" />
          <canvas ref={movingRef} className="pip-sprite pip-lands-canvas" width={view.world.w} height={view.world.h} style={{ width: view.world.w * view.css, height: view.world.h * view.css }} aria-hidden="true" />

          {/* The regions' names, where each begins. */}
          {REGION_NAMES.map((name, region) => {
            const spot = at(regionFrom(region) + 6, view.orient === "wide" ? -view.amp - 34 : -view.amp - 26);
            return (
              <span key={name} className={`pip-lands-region${lands.regions[region].fogged ? " is-fogged" : ""}`} style={spot}>
                {name}
              </span>
            );
          })}
          {lands.far.open && (
            <span className="pip-lands-region" style={at(regionFrom(5) + 6, view.orient === "wide" ? -view.amp - 34 : -view.amp - 26)}>
              {FAR_NAME}
            </span>
          )}

          {/* Fog: a tap says when it lifts. */}
          {lands.regions
            .filter((region) => region.fogged)
            .map((region) => (
              <button
                key={`fog-${region.index}`}
                type="button"
                className="pip-lands-hit is-fog"
                style={{ ...at(regionFrom(region.index) + 64), width: 80 * view.css, height: 60 * view.css }}
                aria-label={`${region.name}, under fog`}
                onClick={() => choose({ what: "fog", region: region.index })}
              />
            ))}

          {/* The strongholds. */}
          {lands.nodes
            .filter((node) => !node.fogged)
            .map((node) => {
              const box = nodeBox(node);
              const spot = at(nodeAlong(node, lands.next));
              const selected = chosen?.what === "node" && chosen.n === node.n;
              return (
                <button
                  key={node.n}
                  type="button"
                  className={`pip-lands-hit is-node${node.next ? " is-next" : ""}${node.taken ? " is-taken" : ""}${selected ? " is-chosen" : ""}`}
                  data-n={node.n}
                  style={{ left: spot.left, top: spot.top + 4 * view.css, width: (box.w + 6) * view.css, height: (box.h + 4) * view.css }}
                  aria-label={nodeLabel(node)}
                  aria-pressed={selected}
                  onClick={() => choose({ what: "node", n: node.n })}
                >
                  {node.taken && node.stars !== null && <Pips count={node.stars} />}
                </button>
              );
            })}

          {/* The King's roost on the peak. */}
          {(() => {
            const spot = at(ROOST_ALONG, view.orient === "wide" ? ROOST_ACROSS : 0);
            return (
              <button
                type="button"
                className={`pip-lands-hit is-node is-roost${lands.roost.lit ? " is-lit" : ""}`}
                style={{ left: spot.left, top: spot.top + 4 * view.css, width: 42 * view.css, height: 42 * view.css }}
                aria-label={lands.roost.fogged ? "The Magpie King's roost, under fog" : lands.roost.lit ? "The Magpie King's roost: he can be raided" : "The Magpie King's roost"}
                onClick={() => choose(lands.roost.fogged ? { what: "fog", region: -1 } : { what: "roost" })}
              />
            );
          })()}

          {/* The day's camps on the road. */}
          {lands.road
            .filter((camp) => !camp.done)
            .map((camp) => {
              const road = roadAt(frontier, camp.slot);
              const spot = at(road.u, road.v);
              return (
                <button
                  key={`road-${camp.slot}`}
                  type="button"
                  className="pip-lands-hit is-road"
                  style={{ left: spot.left, top: spot.top + 2 * view.css, width: 30 * view.css, height: 16 * view.css }}
                  aria-label={`${camp.name}, on the road today`}
                  onClick={() => choose({ what: "road", slot: camp.slot })}
                />
              );
            })}

          {/* The friends' signpost, beside Pip's camp at the start. */}
          {signShown && (
            <button
              type="button"
              className={`pip-lands-hit is-sign${friends && !friends.asked ? " is-new" : ""}`}
              style={{ ...at(SIGN_ALONG, SIGN_ACROSS), width: 20 * view.css, height: 20 * view.css }}
              aria-label="Friends' camps"
              onClick={() => choose({ what: "friends" })}
            />
          )}
        </div>
      </div>

      {/* The one line along the top: a tap for the totals. And the scouts' rest beside it. */}
      <div className="pip-lands-line">
        <button type="button" className="pip-base-round pip-lands-back" aria-label="Back to the camp" title="Back to the camp" onClick={props.onClose}>
          <X size={15} aria-hidden />
        </button>
        <button type="button" className="pip-base-chip pip-lands-progress" aria-expanded={chosen?.what === "totals"} onClick={() => choose(chosen?.what === "totals" ? null : { what: "totals" })}>
          {lands.progress}
        </button>
        <span
          className={`pip-base-chip pip-lands-rest${props.rested > 0 ? " is-good" : ""}`}
          title={base.levels.hut < 1 ? "Build the scouts' hut to raid" : props.rested > 0 ? `Scouts rested for ${props.rested} ${props.rested === 1 ? "raid" : "raids"}` : `The scouts rest as you read: ready in ${props.restIn} min`}
        >
          <Sprite name="scout" box={16} />
          {props.rested > 0 ? props.rested : `${props.restIn} m`}
        </span>
      </div>

      {props.sent && (
        <p className={`pip-lands-sent ${props.sent.won ? "is-won" : "is-lost"}`} role="status">
          <Pips count={props.sent.stars} size="card" /> {raidWords(props.sent)}
        </p>
      )}

      {chosen && (
        <section className="pip-base-enter pip-lands-card" aria-live="polite">
          <button type="button" className="pip-base-round pip-lands-card-close" aria-label="Close" title="Close" onClick={() => setChosen(null)}>
            <X size={15} aria-hidden />
          </button>
          <LandsCard {...props} lands={lands} chosen={chosen} />
        </section>
      )}
    </div>
  );
};

/** The card a tap opens. */
const LandsCard = (props: LandsMapProps & { lands: Lands; chosen: Exclude<Chosen, null> }) => {
  const { base, now, lands, chosen, friends } = props;
  if (chosen.what === "fog") {
    const lifts = chosen.region < 0 ? lands.roost.lifts : lands.regions[chosen.region].lifts;
    return (
      <>
        <h3 className="pip-lands-card-name">{chosen.region < 0 ? "The Magpie King's peak" : lands.regions[chosen.region].name}</h3>
        <p className="pip-lands-card-sub">Under fog until chapter {lifts}.</p>
      </>
    );
  }
  if (chosen.what === "totals") {
    const totals = lands.totals;
    return (
      <>
        <h3 className="pip-lands-card-name">The Magpie Lands</h3>
        <ul className="pip-lands-totals">
          <li>
            <Swords size={13} aria-hidden /> <strong>{totals.taken}</strong> strongholds taken
          </li>
          <li title={totals.unknown > 0 ? `${totals.unknown} taken before stars were kept: replay them for stars` : undefined}>
            <Star size={13} aria-hidden /> <strong>{totals.stars}</strong> of {totals.most} stars{totals.unknown > 0 && <Info size={11} aria-hidden className="ml-1 inline" />}
          </li>
          <li>
            <strong>{totals.threeStar}</strong> with all three
          </li>
          <li>
            <Shield size={13} aria-hidden /> <strong>{totals.keeps}</strong> of 5 keeps
          </li>
          <li>
            <strong>{totals.banners}</strong> {totals.banners === 1 ? "banner" : "banners"}
          </li>
          {totals.far > 0 && (
            <li>
              <strong>{totals.far}</strong> in the Far Rookeries
            </li>
          )}
        </ul>
        <div className="pip-lands-keys">
          <button type="button" className="tactile-button flex items-center gap-1.5 px-2.5 py-1 text-xs" onClick={props.onHut}>
            <Sprite name="hut" variant={Math.max(1, base.levels.hut)} box={18} />
            Scouts' hut
          </button>
          {friends && friends.asked && (
            <label className="flex items-center gap-1.5 text-xs" title="Whether friends may raid your camp. Off, they cannot, and you are not on their list.">
              <input type="checkbox" checked={friends.mayRaid} onChange={(event) => friends.onMayRaid(event.target.checked)} />
              Friends can raid mine
            </label>
          )}
        </div>
      </>
    );
  }
  if (chosen.what === "friends" && friends) {
    return (
      <>
        <h3 className="pip-lands-card-name">Friends' camps</h3>
        {!friends.asked && (
          <div className="pip-raid-ask" role="group" aria-label="Friends' raids">
            <p className="pip-raid-ask-q">Let friends raid your camp? Just for fun: nothing is taken.</p>
            <span className="pip-raid-ask-keys">
              <button type="button" className="tactile-button tactile-button-primary px-3 py-1 text-xs font-semibold" onClick={() => friends.onMayRaid(true)}>
                Yes, let them
              </button>
              <button type="button" className="tactile-button px-3 py-1 text-xs" onClick={() => friends.onMayRaid(false)}>
                Not now
              </button>
            </span>
          </div>
        )}
        {friends.targets === null ? null : friends.targets.length === 0 ? (
          <p className="pip-lands-card-sub">Nobody to raid yet.</p>
        ) : (
          <ul className="pip-lands-friends">
            {friends.targets.map((target) => {
              const blocked = friends.blocked(target);
              return (
                <li key={target.handle}>
                  <Sprite name="burrow" variant={Math.max(1, Math.min(5, target.camp.levels.burrow))} box={30} />
                  <span className="min-w-0 flex-1 truncate">{target.name}</span>
                  <span className="pip-base-acorns" title="Guardians posted">
                    <Shield size={11} aria-hidden /> {(target.camp.guards ?? []).filter((rank) => rank > 0).length}
                  </span>
                  <span className="pip-base-acorns" title="Defences set down">
                    <Hammer size={11} aria-hidden /> {(target.camp.works ?? []).length}
                  </span>
                  <button
                    type="button"
                    className="tactile-button tactile-button-primary flex items-center gap-1 px-2.5 py-1 text-xs font-semibold disabled:opacity-60"
                    disabled={blocked !== null}
                    title={blocked ?? `${friends.scouts} scouts go`}
                    onClick={() => friends.onRaid(target)}
                  >
                    <Swords size={12} aria-hidden /> Raid
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }
  // A raid: a stronghold, the King, or a camp on the road.
  let target: LandsTarget | null = null;
  let plan: RaidPlan;
  let blocked: RaidBlocked | null;
  let picture: ReactNode;
  let title: string;
  let sub: string;
  let extra: ReactNode = null;
  let loot: number;
  if (chosen.what === "roost") {
    plan = theKing(base);
    target = KING_TARGET;
    blocked = raidBlocked(base, "king", now);
    title = "The Magpie King";
    sub = lands.roost.lit ? `${monthName(monthOf(now.day))}: he can be raided` : lands.roost.closed === "won" ? `${monthName(monthOf(now.day))}'s banner is yours` : "He keeps to his roost today";
    picture = <Sprite name="landroost" variant={lands.roost.lit ? 1 : 0} box={44} />;
    loot = plan.loot;
    extra = lands.roost.banners.length > 0 ? <p className="pip-lands-card-sub">{lands.roost.banners.length} {lands.roost.banners.length === 1 ? "banner" : "banners"} on the summit</p> : null;
  } else if (chosen.what === "road") {
    plan = roadCamp(base, now.day, chosen.slot);
    target = roadTarget(chosen.slot);
    blocked = raidBlocked(base, "wild", now, chosen.slot);
    title = plan.name;
    sub = "On the road today";
    picture = <Sprite name="landfolk" variant={chosen.slot} box={36} />;
    loot = plan.loot;
  } else {
    const node = lands.nodes.find((entry) => entry.n === (chosen.what === "node" ? chosen.n : -1));
    if (!node) return null;
    target = raidOf(node);
    plan = node.taken ? (rematchOf(base, node.n) ?? nextCamp(base)) : nextCamp(base);
    blocked = node.taken ? raidBlocked(base, "rematch", now, node.n) : node.next ? raidBlocked(base, "camp", now) : "none";
    title = node.name;
    sub = node.n >= 15 ? `${FAR_NAME} · Stronghold ${node.n + 1}` : `${REGION_NAMES[node.region]} · Stronghold ${node.n + 1}`;
    picture = <Sprite name={node.kind === "keep" ? "landkeep" : "landnode"} variant={node.region} box={44} />;
    // A replay pays for stars past the best: what all three would bring.
    loot = node.taken ? Math.round(replayLoot(base, plan, 3, 1)) : plan.loot;
    extra = (
      <>
        <p className="pip-lands-card-best">
          {node.taken ? (
            node.stars === null ? (
              <span title="Taken before stars were kept: replay it for stars">Taken</span>
            ) : (
              <>
                Best <Pips count={node.stars} size="card" />
              </>
            )
          ) : node.next ? (
            "Next"
          ) : null}
        </p>
        {node.quirk && <p className="pip-base-chip pip-lands-quirk">{node.quirk}</p>}
        {node.lord !== null && (
          <p className="pip-lands-card-sub pip-lands-lord">
            <Sprite name="champion" variant={node.lord} box={20} />
            {CHAMPIONS[node.lord]}
            {node.pennant ? ": his pennant is yours" : ""}
          </p>
        )}
      </>
    );
  }
  // What the scouts would do sent without the reader: the plan made without thinking (`naivePlanOf`), as Send sends.
  const forecast = raidForecast(base, plan, naivePlanOf(base, plan, now.at));
  const replay = target?.kind === "rematch";
  return (
    <>
      <header className="pip-lands-card-head">
        <span className="pip-lands-card-pic">{picture}</span>
        <span className="min-w-0 flex-1">
          <h3 className="pip-lands-card-name">{title}</h3>
          <span className="pip-lands-card-sub">{sub}</span>
        </span>
      </header>
      {extra}
      <p className="pip-lands-card-loot" title={replay ? "A replay brings a little, and more for each star past its best" : undefined}>
        {acornsOf(loot)}
        {chosen.what === "roost" && <Sprite name="banner" variant={seasonOf(now.day)} box={16} />}
      </p>
      {base.levels.hut > 0 && target && (
        <p className="pip-raid-forecast">
          <Pips count={forecast.stars} size="card" />
          <span>{forecast.words}</span>
        </p>
      )}
      {forecast.hint && target && <p className="pip-raid-hint">{forecast.hint}</p>}
      <HeroRow {...props} />
      {target && (
        <div className="pip-lands-keys">
          <button
            type="button"
            className="tactile-button tactile-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            disabled={blocked !== null}
            onClick={() => {
              playSound("horn");
              props.onRaid(target!);
            }}
          >
            <Swords size={13} aria-hidden /> {replay ? "Replay" : "Raid"}
          </button>
          {forecast.canSend && (
            <button
              type="button"
              className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60"
              disabled={blocked !== null}
              title={`The scouts go without you: about ${forecast.brings} acorns`}
              onClick={(event) => props.onSend(target!, event.currentTarget)}
            >
              <Send size={12} aria-hidden /> Send
            </button>
          )}
          {blocked && <span className="pip-raid-why">{props.why(blocked, plan)}</span>}
        </div>
      )}
    </>
  );
};

/** Who goes with the scouts: one hero, or nobody. */
const HeroRow = ({ base, heroes }: LandsMapProps) => {
  if (base.levels.hut < 1 || !HEROES.some((hero) => heroes.here(hero.id))) return null;
  return (
    <div className="pip-raid-heroes" role="group" aria-label="The hero who goes with the scouts" title="One hero goes on each raid">
      <button type="button" className={`pip-base-tile ${base.hero === null ? "is-chosen" : ""}`} aria-pressed={base.hero === null} aria-label="Nobody" title="Nobody goes with them" onClick={() => heroes.onChoose(null)}>
        <UserX size={16} aria-hidden />
      </button>
      {HEROES.filter((hero) => heroes.here(hero.id)).map((hero) => (
        <button
          key={hero.id}
          type="button"
          className={`pip-base-tile ${base.hero === hero.id ? "is-chosen" : ""}`}
          aria-pressed={base.hero === hero.id}
          aria-label={`${hero.name}${heroes.asleep(hero.id) ? ", asleep" : ""}`}
          title={heroes.asleep(hero.id) ? `${hero.name} is asleep: the scouts go without them until they wake` : `${hero.name}, ${hero.title}. ${hero.does}.`}
          onClick={() => heroes.onChoose(hero.id)}
        >
          <Sprite name="hero" variant={hero.id} box={24} className={heroes.asleep(hero.id) ? "is-locked" : ""} />
          {heroes.asleep(hero.id) && <Moon size={10} className="pip-base-tile-mark" aria-hidden />}
        </button>
      ))}
    </div>
  );
};

export type { LandsView };
