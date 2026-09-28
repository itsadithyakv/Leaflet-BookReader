import { useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { SocialProfile } from "@shared/sync/types";
import { socialService } from "../services/socialService";
import { FEATURES } from "../constants/features";
import { useAccountStore } from "../store/accountStore";
import { useHabitStore } from "../store/habitStore";
import { useCommunityStore } from "./community/communityStore";
import { Leaderboard } from "./community/Leaderboard";
import { DuelCards } from "./community/DuelCards";
import { Inbox } from "./community/Inbox";
import { ReaderSearch } from "./community/ReaderSearch";
import { ReaderCard } from "./community/ReaderCard";
import { ProfileCard } from "./community/ProfileCard";

type SocialPanelProps = {
  /** Whether a Leaflet server is configured at all. */
  configured: boolean;
  showToast: (message: string) => void;
};

/** How often the board refreshes while the Social page is on screen. */
const LIVE_MS = 60_000;

/**
 * The community: the weekly board, duels, the inbox, finding readers, and the
 * reader's own profile.
 *
 * Friendly competition, strictly opt-in. Private is the default and is
 * enforced on the server — a private profile is not merely hidden from the
 * board, it is unreadable by handle and cannot follow, cheer or duel. Anyone
 * can look at the public board, signed in or not.
 */
export const SocialPanel = ({ configured, showToast }: SocialPanelProps) => {
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const loadAccount = useAccountStore((state) => state.load);
  const { me, setMe, scope, loadBoard, loadDuels } = useCommunityStore(
    useShallow((state) => ({
      me: state.me,
      setMe: state.setMe,
      scope: state.scope,
      loadBoard: state.loadBoard,
      loadDuels: state.loadDuels
    }))
  );
  const { goalMinutes, activeSession, startSession } = useHabitStore(
    useShallow((state) => ({
      goalMinutes: state.snapshot.goalMinutes,
      activeSession: state.activeSession,
      startSession: state.startSession
    }))
  );
  const live = FEATURES.community && configured;
  const canJoin = signedIn && me?.visibility === "public" && Boolean(me.handle);

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
    socialService
      .profile()
      .then(setMe)
      .catch(() => setMe(null));
  }, [live, signedIn, setMe]);

  // Live-ish: refresh while this page is visible, pause while it is hidden.
  useEffect(() => {
    if (!live) {
      return;
    }
    const refresh = () => {
      if (document.hidden) {
        return;
      }
      void loadBoard(scope === "following" && !signedIn ? "everyone" : scope);
      if (signedIn) {
        void loadDuels();
      }
    };
    refresh();
    const timer = window.setInterval(refresh, LIVE_MS);
    const onVisible = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, scope, signedIn, loadBoard, loadDuels]);

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

  const onStartSession = (minutes: number) => {
    if (activeSession) {
      return;
    }
    startSession({ startedAt: new Date().toISOString(), durationMinutes: minutes });
    showToast(`A ${minutes}-minute session is running. Open a book and go.`);
  };

  if (!live) {
    return (
      <section className="paper-surface rounded-xl p-6">
        <p className="text-xs uppercase tracking-widest text-on-surface-variant">Community</p>
        <h2 className="page-title mt-2 text-2xl">{FEATURES.community ? "Not connected" : "Coming soon"}</h2>
        <p className="mt-3 max-w-prose text-sm leading-6 text-on-surface-variant">
          {FEATURES.community
            ? "Leaderboards and shared shelves need a Leaflet server — the only part of the app that has one. Add its address in Settings. Everything else, including backup, works without it."
            : "Weekly leagues, friends and shared shelves are on their way. Your reading is already being counted, so nothing you read now is lost."}
        </p>
      </section>
    );
  }

  return (
    <>
      <Leaderboard
        signedIn={signedIn}
        canJoin={canJoin}
        goalMinutes={goalMinutes}
        sessionActive={Boolean(activeSession)}
        onStartSession={onStartSession}
      />

      {signedIn && <DuelCards showToast={showToast} />}

      <div className={`grid gap-6 ${signedIn ? "lg:grid-cols-2" : ""}`}>
        {signedIn && <Inbox showToast={showToast} />}
        <ReaderSearch />
      </div>

      {signedIn ? (
        <ProfileCard profile={me} onSaved={onProfileSaved} showToast={showToast} />
      ) : (
        <section className="paper-surface rounded-xl p-6">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Your profile</p>
          <h2 className="page-title mt-2 text-2xl">Not signed in</h2>
          <p className="mt-2 max-w-prose text-sm leading-6 text-on-surface-variant">
            Sign in to a Leaflet account in Settings to join the board, follow readers, send kudos and duel. You can look
            around without one.
          </p>
        </section>
      )}

      <ReaderCard signedIn={signedIn} canJoin={canJoin} showToast={showToast} onChanged={refreshAll} />
    </>
  );
};
