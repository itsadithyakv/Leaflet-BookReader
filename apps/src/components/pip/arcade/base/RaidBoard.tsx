import type { ReactNode } from "react";
import { Hammer, Moon, Send, Shield, Star, Swords, UserX, X } from "lucide-react";
import { monthName, monthOf, seasonOf, type BaseState, type BoardCard, type Now, type RaidEnd, type RaidKind, type RaidBlocked, type RaidPlan } from "../../../../pip/base/rules";
import { HEROES } from "../../../../pip/base/heroes";
import type { RaidTarget } from "../../../../services/socialService";
import { playSound } from "../../../../pip/sound";
import { Sprite } from "./Sprite";
import { raidWords } from "./hollowRules";

const stars = (count: number, size = 13) => (
  <span className="pip-base-stars" aria-label={`${count} of 3 stars`}>
    {[0, 1, 2].map((index) => (
      <Star key={index} size={size} aria-hidden fill={index < count ? "currentColor" : "none"} className={index < count ? "is-won" : ""} />
    ))}
  </span>
);

const acorns = (count: number | string, size = 12) => (
  <span className="pip-base-acorns">
    <Sprite name="acorn" box={size + 2} />
    {count}
    <span className="sr-only"> acorns</span>
  </span>
);

const CARD_NAMES: Record<BoardCard["kind"], string> = { rematch: "Rematch", camp: "Next stronghold", king: "The Magpie King" };

type RaidBoardProps = {
  base: BaseState;
  now: Now;
  board: BoardCard[];
  /** Raids' rest in hand, and the minutes of reading to the next. */
  rested: number;
  restIn: number;
  /** Why a card cannot set out, in a few words. */
  why: (blocked: RaidBlocked, plan: RaidPlan) => string;
  /** What the last "Send" brought, until another raid. */
  sent: RaidEnd | null;
  onFight: (kind: RaidKind) => void;
  onSend: (kind: RaidKind, from: Element) => void;
  onHut: () => void;
  onClose: () => void;
  /** Who goes with the scouts: the heroes here, and who is asleep (by the clock). */
  heroes: { here: (id: number) => boolean; asleep: (id: number) => boolean; onChoose: (id: number | null) => void };
  /** Friends' camps, with an account: the one-time question, the switch, and the camps to raid. */
  friends: {
    asked: boolean;
    mayRaid: boolean;
    onMayRaid: (on: boolean) => void;
    targets: RaidTarget[] | null;
    blocked: (target: RaidTarget) => string | null;
    onRaid: (target: RaidTarget) => void;
    scouts: number;
  } | null;
};

/**
 * The raid board (1.5.10): up to three cards, the rematch, the next stronghold and (from chapter 10) the King,
 * each with what the scouts say of it in a plain sentence and its stars. "Fight it" is always there; "Send" only
 * where the scouts would win. Nothing costs acorns. The scouts' hut is a key here too (it is what raids).
 */
export const RaidBoard = ({ base, now, board, rested, restIn, why, sent, onFight, onSend, onHut, onClose, heroes, friends }: RaidBoardProps) => (
  <div className="pip-base-enter pip-base-sheet pip-raid-board">
    <button type="button" className="pip-base-round pip-base-sheet-close" aria-label="Back to the camp" title="Back to the camp" onClick={onClose}>
      <X size={16} aria-hidden />
    </button>
    <div className="pip-raid-head">
      <p className="pip-raid-rest">
        {base.levels.hut < 1 ? "Build the scouts' hut to raid." : rested > 0 ? `Scouts rested for ${rested} ${rested === 1 ? "raid" : "raids"}` : `The scouts rest as you read: ready in ${restIn} min`}
      </p>
      <button type="button" className="tactile-button flex items-center gap-1.5 px-2.5 py-1 text-xs" onClick={onHut}>
        <Sprite name="hut" variant={Math.max(1, base.levels.hut)} box={18} className={base.levels.hut === 0 ? "is-locked" : ""} />
        Scouts' hut
      </button>
    </div>
    {base.levels.hut > 0 && HEROES.some((hero) => heroes.here(hero.id)) && (
      <div className="pip-raid-heroes" role="group" aria-label="The hero who goes with the scouts" title="One hero goes on each raid">
        <button
          type="button"
          className={`pip-base-tile ${base.hero === null ? "is-chosen" : ""}`}
          aria-pressed={base.hero === null}
          aria-label="Nobody"
          title="Nobody goes with them"
          onClick={() => heroes.onChoose(null)}
        >
          <UserX size={18} aria-hidden />
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
            <Sprite name="hero" variant={hero.id} box={28} className={heroes.asleep(hero.id) ? "is-locked" : ""} />
            {heroes.asleep(hero.id) && <Moon size={10} className="pip-base-tile-mark" aria-hidden />}
          </button>
        ))}
      </div>
    )}
    {sent && (
      <p className={`pip-raid-sent ${sent.won ? "is-won" : "is-lost"}`} role="status">
        {stars(sent.stars)} {raidWords(sent)}
      </p>
    )}
    {base.levels.hut > 0 && (
      <div className="pip-raid-cards">
        {board.map((card) => (
          <RaidCardView key={card.kind} card={card} now={now} why={why} onFight={onFight} onSend={onSend} />
        ))}
      </div>
    )}
    {friends && base.levels.hut > 0 && (
      <section className="pip-raid-friends" aria-label="Friends' camps">
        {!friends.asked ? (
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
        ) : (
          <h3 className="pip-base-heading pip-raid-friends-head">
            Friends' camps
            <label className="ml-auto flex items-center gap-1.5 text-xs font-normal" title="Whether friends may raid your camp. Off, they cannot, and you are not on their list.">
              <input type="checkbox" checked={friends.mayRaid} onChange={(event) => friends.onMayRaid(event.target.checked)} />
              Friends can raid mine
            </label>
          </h3>
        )}
        {friends.targets === null ? null : friends.targets.length === 0 ? (
          <p className="pip-raid-none">Nobody to raid yet.</p>
        ) : (
          <div className="pip-raid-cards">
            {friends.targets.map((target) => {
              const blocked = friends.blocked(target);
              return (
                <div key={target.handle} className="pip-base-card pip-raid-card is-friend">
                  <Sprite name="burrow" variant={Math.max(1, Math.min(5, target.camp.levels.burrow))} box={40} />
                  <div className="min-w-0 flex-1">
                    <p className="pip-base-person truncate">{target.name}</p>
                    <p className="pip-raid-friend-camp">
                      <span className="pip-base-acorns" title="Guardians posted">
                        <Shield size={11} aria-hidden /> {(target.camp.guards ?? []).filter((rank) => rank > 0).length}
                      </span>
                      <span className="pip-base-acorns" title="Defences set down">
                        <Hammer size={11} aria-hidden /> {(target.camp.works ?? []).length}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="tactile-button tactile-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                    disabled={blocked !== null}
                    title={blocked ?? `${friends.scouts} scouts go`}
                    onClick={() => friends.onRaid(target)}
                  >
                    <Swords size={13} aria-hidden /> Raid
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    )}
  </div>
);

const RaidCardView = ({
  card,
  now,
  why,
  onFight,
  onSend
}: {
  card: BoardCard;
  now: Now;
  why: (blocked: RaidBlocked, plan: RaidPlan) => string;
  onFight: (kind: RaidKind) => void;
  onSend: (kind: RaidKind, from: Element) => void;
}) => {
  const { plan, forecast, blocked } = card;
  const king = card.kind === "king";
  const picture: ReactNode = (
    <span className="pip-base-portrait">
      <Sprite name={king ? "king" : "nest"} variant={king ? undefined : plan.tier} box={50} />
      {plan.champion !== null && <Sprite name="champion" variant={plan.champion} box={28} className="pip-base-portrait-foe" />}
    </span>
  );
  return (
    <section className={`pip-base-card pip-raid-card is-${card.kind} ${forecast.canSend ? "is-winnable" : "is-hard"}`}>
      <div className="pip-raid-card-top">
        {picture}
        <div className="min-w-0 flex-1">
          <p className="pip-raid-card-kind">{CARD_NAMES[card.kind]}</p>
          <h3 className="pip-raid-card-name">{plan.name}</h3>
          <p className="pip-raid-card-loot">
            {acorns(plan.loot, 12)}
            {king && <Sprite name="banner" variant={seasonOf(now.day)} box={16} />}
            {king && <span className="sr-only">and {monthName(monthOf(now.day))}'s banner</span>}
          </p>
        </div>
      </div>
      <p className="pip-raid-forecast">
        {stars(forecast.stars, 12)}
        <span>{forecast.words}</span>
      </p>
      {forecast.hint && <p className="pip-raid-hint">{forecast.hint}</p>}
      <div className="pip-raid-keys">
        <button
          type="button"
          className="tactile-button tactile-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
          disabled={blocked !== null}
          onClick={() => {
            playSound("horn");
            onFight(card.kind);
          }}
        >
          <Swords size={13} aria-hidden /> Fight it
        </button>
        {forecast.canSend && (
          <button
            type="button"
            className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60"
            disabled={blocked !== null}
            title={`The scouts go without you: about ${forecast.brings} acorns`}
            onClick={(event) => onSend(card.kind, event.currentTarget)}
          >
            <Send size={12} aria-hidden /> Send
          </button>
        )}
        {blocked && <span className="pip-raid-why">{why(blocked, plan)}</span>}
      </div>
    </section>
  );
};

