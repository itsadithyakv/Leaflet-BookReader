import { useEffect, type ReactNode } from "react";
import { FEATURES } from "../../constants/features";
import { useAccountStore } from "../../store/accountStore";
import { useLibraryStore } from "../../store/libraryStore";
import { PipSprite } from "../PipSprite";
import { SectionHeader } from "../ui/SectionHeader";
import { useCommunityStore } from "../community/communityStore";
import { COPY, PROFILE_PLACE } from "../community/copy";
import { at } from "../community/format";
import { AdminPanel } from "./AdminPanel";
import { CommunitiesPanel } from "./Communities";
import { DiscoverFeed } from "./DiscoverPanel";

type Toast = (message: string) => void;

/**
 * What stands in for a tab of the public community when it cannot be shown:
 * no server, nobody signed in, or a profile that is not shared. Reading it
 * needs an account with a shared profile, like following does; writing in it
 * needs more, which the server says when it is tried.
 */
const Gate = ({ name, onNavigate, children }: { name: string; onNavigate: (tab: "settings") => void; children: ReactNode }) => {
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const apiBase = useLibraryStore((state) => state.sync.apiBase);
  const me = useCommunityStore((state) => state.me);
  const loadMe = useCommunityStore((state) => state.loadMe);
  const live = FEATURES.community && Boolean(apiBase);
  useEffect(() => {
    if (live && signedIn && !me) {
      void loadMe();
    }
  }, [live, signedIn, me, loadMe]);

  if (!live) {
    return (
      <section className="paper-surface rounded-xl p-6">
        <SectionHeader eyebrow={name} title={FEATURES.community ? "Not connected" : "Coming soon"} />
        <p className="mt-3 max-w-prose text-sm leading-6 text-on-surface-variant">{FEATURES.community ? COPY.notConnected : COPY.comingSoon}</p>
      </section>
    );
  }
  if (!signedIn) {
    return (
      <section className="paper-surface flex flex-wrap items-center gap-5 rounded-xl p-6">
        <PipSprite move="welcome" size={64} still />
        <div className="min-w-0 flex-1">
          <SectionHeader eyebrow={name} title={COPY.signInTitle} />
          <p className="mt-2 max-w-prose text-sm leading-6 text-on-surface-variant">{COPY.signIn}</p>
        </div>
        <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs" onClick={() => onNavigate("settings")}>
          Sign in
        </button>
      </section>
    );
  }
  if (me && (me.visibility === "private" || !me.handle)) {
    return (
      <section className="paper-surface rounded-xl p-6">
        <SectionHeader eyebrow={name} title="Share your profile first" />
        <p className="mt-3 max-w-prose text-sm leading-6 text-on-surface-variant">
          Your profile is private{me.handle ? ` (${at(me.handle)})` : ""}. Share it under {PROFILE_PLACE} to read what other readers post.
        </p>
      </section>
    );
  }
  return <>{children}</>;
};

/** The Discover tab: what readers anywhere posted for everyone; and, for the owner, what was reported. */
export const DiscoverPanel = ({ showToast, onNavigate }: { showToast: Toast; onNavigate: (tab: "settings") => void }) => {
  const isAdmin = useCommunityStore((state) => Boolean(state.me?.isAdmin));
  return (
    <Gate name="Discover" onNavigate={onNavigate}>
      {isAdmin && <AdminPanel showToast={showToast} />}
      <DiscoverFeed showToast={showToast} />
    </Gate>
  );
};

/** The Communities tab: one community a book or a series, each with its threads. */
export const CommunitiesTab = ({ showToast, onNavigate }: { showToast: Toast; onNavigate: (tab: "settings") => void }) => (
  <Gate name="Communities" onNavigate={onNavigate}>
    <CommunitiesPanel showToast={showToast} />
  </Gate>
);
