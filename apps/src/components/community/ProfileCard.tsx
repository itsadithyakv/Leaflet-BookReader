import { useEffect, useState } from "react";
import { Copy, Pencil } from "lucide-react";
import type { SocialProfile } from "@shared/sync/types";
import { socialService } from "../../services/socialService";
import { useAccountStore } from "../../store/accountStore";
import { randomAvatar } from "../../pip/avatars";
import { AvatarPicker } from "../AvatarPicker";
import { EYEBROW } from "../ui/SectionHeader";
import { PipAvatar } from "./PipAvatar";
import { SharedShelf } from "./SharedShelf";
import { at, errorText } from "./format";

type ProfileCardProps = {
  profile: SocialProfile | null;
  onSaved: (profile: SocialProfile) => void;
  showToast: (message: string) => void;
  /** Opens the Pip tab, where a reader dresses their own Pip. */
  onOpenPip: () => void;
};

type Panel = "none" | "details" | "avatar";

/**
 * You, as other readers see you: the one place for your Pip, name, handle and
 * the switch that matters, private (the default; nothing is shared) or public
 * (on the board, visible by handle, able to follow, send kudos and duel).
 *
 * Settings keeps the account itself (email, password); everything that
 * appears on the board is edited here.
 */
export const ProfileCard = ({ profile, onSaved, showToast, onOpenPip }: ProfileCardProps) => {
  const account = useAccountStore((state) => state.status.account);
  const saveAvatar = useAccountStore((state) => state.setAvatar);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState(() => account?.avatar ?? randomAvatar().id);
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The name given at sign-up seeds the profile's, so there is one name, not two.
  useEffect(() => {
    setHandle(profile?.handle ?? "");
    setDisplayName(profile?.displayName ?? account?.displayName ?? "");
  }, [profile?.handle, profile?.displayName, account?.displayName]);

  // A reader without a handle has nothing to show yet: start with the fields open.
  useEffect(() => {
    if (profile && !profile.handle) {
      setPanel((current) => (current === "none" ? "details" : current));
    }
  }, [profile]);

  const isPublic = profile?.visibility === "public";
  const name = profile?.displayName || account?.displayName || (profile?.handle ? at(profile.handle) : "Your profile");

  const open = (next: Panel) => {
    setError(null);
    if (next === "avatar") {
      setAvatar(account?.avatar ?? randomAvatar().id);
    }
    setPanel((current) => (current === next ? "none" : next));
  };

  // Friends find each other by handle, so the handle is the invite.
  const copyInvite = () => {
    if (!profile?.handle) {
      return;
    }
    const invite = `Add me on Leaflet: ${at(profile.handle)} (Social → Community → Find readers)`;
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
        if (!visibility) {
          setPanel("none");
        }
        showToast(
          visibility === "public"
            ? "Your profile is shared. You're on this week's board."
            : visibility === "private"
              ? "Your profile is private again. You're off the board."
              : "Saved."
        );
      })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const saveNewAvatar = () => {
    setBusy(true);
    setError(null);
    saveAvatar(avatar)
      .then(() => {
        setPanel("none");
        showToast("Your Pip is updated.");
      })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const needsHandle = !isPublic && handle.trim().length === 0;

  return (
    <section className="paper-surface rounded-xl p-6" aria-labelledby="you-title">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => open("avatar")}
          className="group relative rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Change your Pip"
          title="Change your Pip"
        >
          <PipAvatar seed={profile?.handle ?? null} avatar={account?.avatar ?? null} size={64} play="idle" label="Your Pip" />
          <span className="absolute -bottom-1 -right-1 rounded-full bg-surface-container-high p-1 text-on-surface-variant shadow ring-1 ring-outline-variant/50 group-hover:text-primary">
            <Pencil size={11} aria-hidden />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className={EYEBROW}>You</p>
          <h2 id="you-title" className="page-title mt-1 truncate text-2xl">
            {name}
          </h2>
          <p className="mt-0.5 text-sm text-on-surface-variant">
            {isPublic ? (
              <>
                Shared as <span className="font-semibold text-on-surface">{at(profile?.handle)}</span>
              </>
            ) : (
              "Private: not on the board, and not visible to other readers."
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="tactile-button px-4 py-2 text-xs"
            onClick={() => open("details")}
            aria-expanded={panel === "details"}
          >
            Edit name and handle
          </button>
          {isPublic && profile?.handle && (
            <button type="button" className="tactile-button flex items-center gap-1.5 px-4 py-2 text-xs" onClick={copyInvite} title="Copies a line with your handle to send to a friend">
              <Copy size={13} aria-hidden />
              Copy invite
            </button>
          )}
          <button
            type="button"
            className={`tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${isPublic ? "" : "tactile-button-primary"}`}
            onClick={() => save(isPublic ? "private" : "public")}
            disabled={busy || needsHandle}
            title={needsHandle ? "Pick a handle first" : undefined}
          >
            {isPublic ? "Make private" : "Share my profile"}
          </button>
        </div>
      </div>

      <p className="mt-3 max-w-prose text-xs leading-5 text-on-surface-variant">
        {isPublic
          ? "Your Pip, name, handle, streak, weekly minutes and shelf are visible to other readers."
          : "Share your profile to appear on the board and to follow, send kudos and duel."}
      </p>

      {panel === "details" && (
        <div className="mt-5 border-t border-outline-variant/40 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={EYEBROW}>Name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="How you appear"
                maxLength={40}
                className="inset-field mt-1 w-full px-3 py-2 text-sm text-on-surface"
              />
            </label>
            <label className="block">
              <span className={EYEBROW}>Handle</span>
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
          {needsHandle && <p className="mt-2 text-[11px] text-on-surface-variant">Pick a handle: it's how other readers find you.</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => save()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {profile?.handle && (
              <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={() => open("details")} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {panel === "avatar" && (
        <div className="mt-5 border-t border-outline-variant/40 pt-4">
          <AvatarPicker value={avatar} onChange={setAvatar} disabled={busy} label="Your Pip" />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || avatar === account?.avatar}
              onClick={saveNewAvatar}
            >
              {busy ? "Saving…" : "Use this Pip"}
            </button>
            <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={() => open("avatar")} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={onOpenPip}>
              Or dress your own Pip on the Pip tab
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>}

      {isPublic && profile && panel === "none" && (
        <div className="mt-5 border-t border-outline-variant/40 pt-4">
          <p className={EYEBROW}>Your shelf, as others see it</p>
          <div className="mt-3">
            <SharedShelf shelf={profile.shelf} emptyText="Your shelf fills as you finish focus sessions." />
          </div>
        </div>
      )}
    </section>
  );
};
