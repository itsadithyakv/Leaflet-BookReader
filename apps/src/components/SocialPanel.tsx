import { watchForeground } from "../services/windowService";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Book } from "@shared/models/book";
import type { SocialProfile } from "@shared/sync/types";
import { socialService } from "../services/socialService";
import { FEATURES } from "../constants/features";
import { useAccountStore } from "../store/accountStore";
import { useHabitStore } from "../store/habitStore";
import { SectionHeader } from "./ui/SectionHeader";
import { useCommunityStore } from "./community/communityStore";
import { COPY } from "./community/copy";
import { errorText } from "./community/format";
import { Leaderboard } from "./community/Leaderboard";
import { DuelCards } from "./community/DuelCards";
import { Inbox } from "./community/Inbox";
import { ReaderSearch } from "./community/ReaderSearch";
import { ProfileCard } from "./community/ProfileCard";
import { SignInPrompt } from "./account/SignInPrompt";

/** Where the community sends a reader: to set up an account, dress Pip, or pick a book. */
export type SocialNavTarget = "settings" | "pip" | "library";

type SocialPanelProps = {
  /** Whether a Leaflet server is configured at all. */
  configured: boolean;
  showToast: (message: string) => void;
  nowReading: Book | null;
  onReadNow: (minutes: number) => void;
  onNavigate: (tab: SocialNavTarget) => void;
};

/**
 * How often the board refreshes while the Social page is on screen. It
 * counts a week's reading: five minutes is as live as it needs to be, and a
 * fifth of what it asked of the server at one.
 */
const LIVE_MS = 5 * 60_000;
/** Coming back to the window refreshes it, but not at every switch between windows. */
const BACK_MS = 60_000;

/**
 * The community, in the order a reader comes for it: who you are, the board,
 * your duels, your news, and finding readers.
 *
 * Friendly competition, and the reader's choice. A profile made at sign-up
 * is shared unless the form's switch is turned off (accounts from before 1.2
 * stay private until their owner shares them), and "Make private" is always
 * there. Private is enforced on the server — a private profile is not merely
 * hidden from the board, it is unreadable by handle and cannot follow, send
 * kudos or duel.
 * Anyone can look at the public board, signed in or not.
 */
export const SocialPanel = ({ configured, showToast, nowReading, onReadNow, onNavigate }: SocialPanelProps) => {
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const loadAccount = useAccountStore((state) => state.load);
  const { me, meError, setMe, loadMe, scope, loadBoard, loadDuels, publish } = useCommunityStore(
    useShallow((state) => ({
      me: state.me,
      meError: state.meError,
      setMe: state.setMe,
      loadMe: state.loadMe,
      scope: state.scope,
      loadBoard: state.loadBoard,
      loadDuels: state.loadDuels,
      publish: state.publish
    }))
  );
  const [shareBusy, setShareBusy] = useState(false);
  const [handleNudge, setHandleNudge] = useState(0);
  const { goalMinutes, activeSession } = useHabitStore(
    useShallow((state) => ({
      goalMinutes: state.snapshot.goalMinutes,
      activeSession: state.activeSession
    }))
  );
  const live = FEATURES.community && configured;
  // Shared with everyone or kept to followers: either may follow, send kudos and duel.
  const canJoin = signedIn && Boolean(me) && me?.visibility !== "private" && Boolean(me?.handle);

  useEffect(() => {
    if (live) {
      void loadAccount(true);
    }
  }, [live, loadAccount]);

  useEffect(() => {
    if (!live || !signedIn) {
      setMe(null);
      return;
    }
    // A failed read is kept as a failure (`meError`), not shown as "private".
    void loadMe();
  }, [live, signedIn, setMe, loadMe]);

  // Live-ish: refresh while this page is visible, pause while it is hidden.
  // Your own minutes go up first, so your row is current when the board lands.
  useEffect(() => {
    if (!live) {
      return;
    }
    let stopped = false;
    let inFront = true;
    let arrivedAt = Date.now();
    // Arriving (the page opened, or come back to): the reader's own minutes first, and their duels. On the timer after
    // that, the board alone: the pulse keeps the reader's own numbers and their duels up to date between.
    const refresh = async (arriving: boolean) => {
      if (document.hidden || !inFront) {
        return;
      }
      if (signedIn && arriving) {
        await publish();
      }
      if (stopped) {
        return;
      }
      void loadBoard(scope === "following" && !signedIn ? "everyone" : scope);
      if (signedIn && arriving) {
        void loadDuels();
      }
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), LIVE_MS);
    const back = () => {
      if (document.hidden || !inFront || Date.now() - arrivedAt < BACK_MS) {
        return;
      }
      arrivedAt = Date.now();
      void refresh(true);
    };
    document.addEventListener("visibilitychange", back);
    // Behind another window nobody is looking at it: nothing is asked for until it is in front again.
    const unwatch = watchForeground((front) => {
      inFront = front;
      if (front) back();
    });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      unwatch();
      document.removeEventListener("visibilitychange", back);
    };
  }, [live, scope, signedIn, loadBoard, loadDuels, publish]);

  const refreshAll = useCallback(() => {
    void loadBoard("everyone");
    if (signedIn) {
      void loadBoard("following");
      void loadDuels();
    }
  }, [signedIn, loadBoard, loadDuels]);

  const onProfileSaved = useCallback(
    (saved: SocialProfile) => {
      setMe(saved);
      refreshAll();
    },
    [setMe, refreshAll]
  );

  // "Share my profile" on the reader's own board row: the profile card's
  // switch, pressed from where they are looking. A profile is shared under a
  // handle, so without one this opens the card's fields instead.
  const shareFromBoard = useCallback(() => {
    if (!me?.handle) {
      setHandleNudge((count) => count + 1);
      showToast(COPY.pickHandleFirst);
      return;
    }
    setShareBusy(true);
    socialService
      .saveProfile({
        handle: me.handle,
        // The profile's own name, or none. The sign-up name is not put in its
        // place here: this button shows no field for the reader to see it in.
        displayName: me.displayName,
        visibility: "public"
      })
      .then((saved) => {
        onProfileSaved(saved);
        showToast(COPY.sharedToast);
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setShareBusy(false));
  }, [me, onProfileSaved, showToast]);

  if (!live) {
    return (
      <section className="paper-surface rounded-xl p-6">
        <SectionHeader eyebrow="Community" title={FEATURES.community ? "Not connected" : "Coming soon"} />
        <p className="mt-3 max-w-prose text-sm leading-6 text-on-surface-variant">
          {FEATURES.community ? COPY.notConnected : COPY.comingSoon}
        </p>
      </section>
    );
  }

  return (
    <>
      {signedIn ? (
        <ProfileCard
          profile={me}
          loadError={meError}
          onRetry={() => void loadMe()}
          handleNudge={handleNudge}
          onSaved={onProfileSaved}
          showToast={showToast}
          onOpenPip={() => onNavigate("pip")}
        />
      ) : (
        <SignInPrompt line="Sign in to join the board." onSettings={() => onNavigate("settings")} />
      )}

      <Leaderboard
        signedIn={signedIn}
        canJoin={canJoin}
        goalMinutes={goalMinutes}
        sessionActive={Boolean(activeSession)}
        nowReading={nowReading}
        onReadNow={onReadNow}
        onShare={shareFromBoard}
        shareBusy={shareBusy}
      />

      {signedIn && <DuelCards showToast={showToast} />}

      <div className={`grid gap-6 [&>*]:min-w-0 ${signedIn ? "lg:grid-cols-2" : ""}`}>
        {signedIn && <Inbox showToast={showToast} />}
        <ReaderSearch showToast={showToast} />
      </div>
    </>
  );
};
