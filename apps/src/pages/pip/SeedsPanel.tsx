import type { SeedEarnings } from "../../services/pipService";
import { FEATURES } from "../../constants/features";
import { Hint, Hints } from "../../components/pip/shopParts";
import { PipAvatar } from "../../components/community/PipAvatar";
import { CountUp } from "../../components/community/CountUp";
import { UiIcon } from "../../components/UiIcon";

type SeedsPanelProps = {
  /** Seeds to spend now. */
  spendable: number;
  /** Where the seeds came from, once the wallet has loaded. */
  earned: SeedEarnings | undefined;
  /** Spent on Pip, as the wallet has it. */
  spent: number | undefined;
  /** Spent on a quick purchase the wallet has not taken yet. */
  ahead: number;
  /** Water poured into the garden, all told. */
  water: number | undefined;
  /** Opens Pip's mood: why it is what it is. */
  onMood: () => void;
  onWalk: () => void;
  /** Pip as a profile picture, for a reader with an account. */
  myAvatar: string;
  signedIn: boolean;
  avatarInUse: boolean;
  onUseMyPip: () => Promise<void>;
};

/** Seeds: the wallet and where its seeds came from. (Pip's mood has a panel of its own.) */
export const SeedsPanel = ({ spendable, earned, spent, ahead, water, onMood, onWalk, myAvatar, signedIn, avatarInUse, onUseMyPip }: SeedsPanelProps) => (
  <>
    <p className="flex items-center gap-2 font-headline text-4xl font-bold tabular-nums text-on-surface">
      <UiIcon name="seed" size={26} className="text-primary" />
      <CountUp value={spendable} />
    </p>
    <Hints>
      <Hint icon="garden" more="Reading in focus waters Pip's garden; ripe plants are picked for seeds.">
        Seeds grow in the garden
      </Hint>
      <Hint icon="sparkle" more="Goal days add a few more seeds, and a few more still on a streak.">
        Goal days add more
      </Hint>
      <Hint icon="game" more="Games cheer Pip up a little each day, but never pay seeds.">
        Games never pay seeds
      </Hint>
    </Hints>
    {earned && (
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs tabular-nums text-on-surface-variant">
        <dt>Harvests</dt>
        <dd>{earned.harvests}</dd>
        <dt>Goal days</dt>
        <dd>{earned.goalDays}</dd>
        <dt>Streak bonus</dt>
        <dd>{earned.streakBonus}</dd>
        <dt>Welcome gift</dt>
        <dd>{earned.welcome}</dd>
        {earned.chest > 0 && (
          <>
            <dt>Starter chest</dt>
            <dd>{earned.chest}</dd>
          </>
        )}
        {earned.goals > 0 && (
          <>
            <dt>First steps</dt>
            <dd>{earned.goals}</dd>
          </>
        )}
        {earned.sets > 0 && (
          <>
            <dt>Sets finished</dt>
            <dd>{earned.sets}</dd>
          </>
        )}
        {earned.wishes > 0 && (
          <>
            <dt>Wishes granted</dt>
            <dd>{earned.wishes}</dd>
          </>
        )}
        {earned.earlier > 0 && (
          <>
            <dt>Earned before the garden</dt>
            <dd>{earned.earlier}</dd>
          </>
        )}
        <dt>Spent on Pip</dt>
        <dd>−{(spent ?? 0) + ahead}</dd>
        <dt>Water poured, all told</dt>
        <dd>{Math.round(water ?? 0)}</dd>
      </dl>
    )}
    <div className="section-rule mt-4 flex flex-wrap gap-2 pt-3">
      <button type="button" className="pip-key" onClick={() => onMood()}>
        <UiIcon name="heart" size={15} />
        Why Pip's mood is what it is
      </button>
    </div>
    <button type="button" className="pip-key mt-3" onClick={() => onWalk()}>
      <UiIcon name="help" size={15} />
      Show me around again
    </button>
    {FEATURES.accounts && (
      <div className="section-rule mt-4 flex items-center gap-3 pt-3">
        <PipAvatar seed={null} avatar={myAvatar} size={56} play label="Your Pip as a profile picture" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Profile picture</p>
          {signedIn ? (
            <button
              type="button"
              className="tactile-button mt-1 px-3 py-1.5 text-xs disabled:cursor-default disabled:opacity-60"
              onClick={() => void onUseMyPip()}
              disabled={avatarInUse}
            >
              {avatarInUse ? "In use" : "Use my Pip"}
            </button>
          ) : (
            <p className="mt-1 text-xs text-on-surface-variant">Sign in (Settings, Account) to wear your Pip on the leaderboard.</p>
          )}
        </div>
      </div>
    )}
  </>
);
