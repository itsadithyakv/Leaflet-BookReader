import { useEffect, useState } from "react";
import type { SocialProfile } from "@shared/sync/types";
import { socialService } from "../../services/socialService";
import { useAccountStore } from "../../store/accountStore";
import { PipAvatar } from "./PipAvatar";
import { SharedShelf } from "./SharedShelf";
import { at, errorText } from "./format";

type ProfileCardProps = {
  profile: SocialProfile | null;
  onSaved: (profile: SocialProfile) => void;
  showToast: (message: string) => void;
};

/**
 * The reader's own profile: name, handle, and the one switch that matters —
 * private (the default; nothing is shared) or public (on the board, visible by
 * handle, able to follow, cheer and duel).
 */
export const ProfileCard = ({ profile, onSaved, showToast }: ProfileCardProps) => {
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The avatar belongs to the account (picked in Settings); the board shows it.
  const avatar = useAccountStore((state) => state.status.account?.avatar ?? null);

  useEffect(() => {
    setHandle(profile?.handle ?? "");
    setDisplayName(profile?.displayName ?? "");
  }, [profile?.handle, profile?.displayName]);

  const isPublic = profile?.visibility === "public";

  // Friends find each other by handle, so the handle is the invite.
  const copyInvite = () => {
    if (!profile?.handle) {
      return;
    }
    const invite = `Add me on Leaflet: ${at(profile.handle)} (Social → Find readers)`;
    navigator.clipboard
      .writeText(invite)
      .then(() => showToast("Copied. Send it to a friend."))
      .catch(() => showToast(`Your handle is ${at(profile.handle)}.`));
  };

  const save = (visibility?: "private" | "public") => {
    setBusy(true);
    setError(null);
    socialService
      .saveProfile({
        handle: handle.trim() || null,
        displayName: displayName.trim() || null,
        visibility: visibility ?? profile?.visibility ?? "private"
      })
      .then((saved) => {
        onSaved(saved);
        if (visibility) {
          showToast(
            saved.visibility === "public"
              ? "Your profile is shared. You're on this week's board."
              : "Your profile is private again. You're off the board."
          );
        } else {
          showToast("Saved.");
        }
      })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="paper-surface rounded-xl p-6" aria-labelledby="profile-title">
      <div className="flex items-start gap-4">
        {profile?.handle && <PipAvatar seed={profile.handle} avatar={avatar} size={56} play label="Your Pip" />}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Your profile</p>
          <h2 id="profile-title" className="page-title mt-2 text-2xl">
            {isPublic ? `Shared as ${at(profile?.handle)}` : "Private"}
          </h2>
          <p className="mt-2 max-w-prose text-sm leading-6 text-on-surface-variant">
            {isPublic
              ? "Your handle, streak, weekly minutes and shelf are visible to other readers, and you can follow, send kudos and duel."
              : "Nothing is shared. Make it public to appear on the board, and to follow, cheer and duel other readers."}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Display name</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="How you appear"
            maxLength={40}
            className="inset-field mt-1 w-full px-3 py-2 text-sm text-on-surface"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Handle</span>
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value.toLowerCase())}
            placeholder="letters, numbers, - and _"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={24}
            className="inset-field mt-1 w-full px-3 py-2 text-sm text-on-surface"
          />
        </label>
      </div>

      {error && <p className="mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className="tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => save()}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => save(isPublic ? "private" : "public")}
          disabled={busy || (!isPublic && handle.trim().length === 0)}
        >
          {isPublic ? "Make private" : "Share my profile"}
        </button>
        {isPublic && profile?.handle && (
          <button
            type="button"
            className="tactile-button px-4 py-2 text-xs"
            onClick={copyInvite}
            title="Copies a line with your handle to send to a friend"
          >
            Copy invite
          </button>
        )}
      </div>
      {!isPublic && handle.trim().length === 0 && (
        <p className="mt-2 text-[11px] text-on-surface-variant">Pick a handle first — it's how other readers find you.</p>
      )}

      {isPublic && profile && (
        <div className="mt-6 border-t border-outline-variant/40 pt-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Your shelf, as others see it</p>
          <div className="mt-3">
            <SharedShelf shelf={profile.shelf} />
          </div>
        </div>
      )}
    </section>
  );
};
