import { useState } from "react";
import { Swords, Trophy } from "lucide-react";
import type { Duel } from "../../services/socialService";
import { useCommunityStore } from "./communityStore";
import { PipAvatar } from "./PipAvatar";
import { at, errorText, localWeekEnd, minutesText, nameOf, timeLeftText } from "./format";

const resultText = (duel: Duel) =>
  duel.result === "won" ? "You won this one." : duel.result === "lost" ? `${at(duel.them?.handle)} took this one.` : "A dead heat.";

/**
 * The tug of war: your share of the pair's minutes from the left, theirs from
 * the right, with the knot where they meet. Even at 0–0.
 */
const TugOfWar = ({ mine, theirs }: { mine: number; theirs: number }) => {
  const total = mine + theirs;
  const share = total > 0 ? Math.min(96, Math.max(4, (mine / total) * 100)) : 50;
  return (
    <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-tertiary/35" role="img" aria-label={`${Math.round(share)}% of the minutes are yours`}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${share}%` }} />
      <div
        className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-on-surface/70 transition-[left] duration-700 ease-out"
        style={{ left: `${share}%` }}
      />
    </div>
  );
};

const DuelCard = ({ duel, showToast }: { duel: Duel; showToast: (message: string) => void }) => {
  const respond = useCommunityStore((state) => state.respondToDuel);
  const openReader = useCommunityStore((state) => state.openReader);
  const [busy, setBusy] = useState(false);
  const them = duel.them;
  if (!them) {
    return null;
  }
  const incoming = duel.status === "pending" && !duel.youChallenged;

  const answer = (accept: boolean) => {
    setBusy(true);
    respond(duel.id, accept)
      .then(() => showToast(accept ? `Duel on. Good luck against ${at(them.handle)}!` : "Declined. No hard feelings."))
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <li className="list-none rounded-xl bg-surface-container/60 p-4 ring-1 ring-outline-variant/30">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <PipAvatar seed={duel.you.pipSeed} avatar={duel.you.avatar} size={36} />
          <div className="min-w-0">
            <p className="truncate text-xs text-on-surface-variant">You</p>
            <p className="font-headline text-lg font-bold tabular-nums text-on-surface">{minutesText(duel.you.minutes)}</p>
          </div>
        </div>
        <Swords size={18} className="shrink-0 text-on-surface-variant" aria-hidden />
        <button type="button" className="flex min-w-0 items-center gap-2 text-right" onClick={() => openReader(them.handle)}>
          <div className="min-w-0">
            <p className="truncate text-xs text-on-surface-variant hover:underline">{nameOf(them)}</p>
            <p className="font-headline text-lg font-bold tabular-nums text-on-surface">{minutesText(them.minutes)}</p>
          </div>
          <PipAvatar seed={them.pipSeed} avatar={them.avatar} size={36} />
        </button>
      </div>

      <TugOfWar mine={duel.you.minutes} theirs={them.minutes} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
        {duel.status === "finished" ? (
          <span className="flex items-center gap-1.5 font-semibold text-on-surface">
            {duel.result === "won" && <Trophy size={14} className="text-[#d4a73a]" aria-hidden />}
            {resultText(duel)}
          </span>
        ) : duel.weekOver ? (
          <span>Week over — the final tally lands shortly.</span>
        ) : duel.status === "pending" ? (
          <span>{incoming ? `${at(them.handle)} challenged you.` : `Waiting for ${at(them.handle)} to accept.`}</span>
        ) : (
          <span>Ends in {timeLeftText(localWeekEnd())} · most minutes wins</span>
        )}
        {incoming && !duel.weekOver && (
          <span className="flex gap-2">
            <button type="button" disabled={busy} className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60" onClick={() => answer(false)}>
              Decline
            </button>
            <button type="button" disabled={busy} className="tactile-button tactile-button-primary px-3 py-1.5 text-xs disabled:opacity-60" onClick={() => answer(true)}>
              Accept
            </button>
          </span>
        )}
      </div>
    </li>
  );
};

/** This week's duels and last week's results. Hidden when there are none. */
export const DuelCards = ({ showToast }: { showToast: (message: string) => void }) => {
  const duels = useCommunityStore((state) => state.duels);
  if (duels.length === 0) {
    return null;
  }
  return (
    <section className="paper-surface rounded-xl p-6" aria-labelledby="duels-title">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">Friendly rivalry</p>
      <h2 id="duels-title" className="page-title mt-2 text-2xl">
        Duels
      </h2>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {duels.map((duel) => (
          <DuelCard key={duel.id} duel={duel} showToast={showToast} />
        ))}
      </ul>
    </section>
  );
};
