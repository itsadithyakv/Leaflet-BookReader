import { useEffect, useRef, useState } from "react";
import { Copy, Pencil } from "lucide-react";
import type { ProfileVisibility, SocialProfile } from "@shared/sync/types";
import { socialService } from "../../services/socialService";
import { friendsService, type FollowRequest } from "../../services/friendsService";
import { discussService } from "../../services/discussService";
import type { CommunityPerson } from "../../services/socialService";
import { useAccountStore } from "../../store/accountStore";
import { randomAvatar } from "../../pip/avatars";
import { AvatarPicker } from "../AvatarPicker";
import { EYEBROW } from "../ui/SectionHeader";
import { COPY } from "./copy";
import { PipAvatar } from "./PipAvatar";
import { SharedShelf } from "./SharedShelf";
import { at, errorText, nameToEdit } from "./format";
import { handleProblem } from "./handle";
import { HandleField } from "./HandleField";

type ProfileCardProps = {
  /** The reader's profile; null while it loads, and when it could not be read. */
  profile: SocialProfile | null;
  /** Why the profile could not be read. A failed load is not a private profile. */
  loadError?: string | null;
  onRetry?: () => void;
  /**
   * Counts up each time the board's own row asks to share a profile that has
   * no handle yet: the card opens its fields and puts the cursor in Handle.
   */
  handleNudge?: number;
  onSaved: (profile: SocialProfile) => void;
  showToast: (message: string) => void;
  /** Opens the Pip tab, where a reader dresses their own Pip. */
  onOpenPip: () => void;
};

type Panel = "none" | "details" | "avatar";

/** The three ways a profile can stand, as the switch names them. */
const WAYS: Array<{ id: ProfileVisibility; label: string; hint: string }> = [
  { id: "public", label: "Public", hint: "On the board, and anyone can read your profile" },
  { id: "followers", label: "Followers", hint: "Found by your handle; only readers you accept can read your profile" },
  { id: "private", label: "Private", hint: "Nothing is shared, and nobody can find you" }
];

/** Readers waiting for an answer from a profile kept to followers. Nothing is drawn when there are none. */
const FollowRequests = ({ showToast }: { showToast: (message: string) => void }) => {
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    friendsService
      .followRequests()
      .then((found) => live && setRequests(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (requests.length === 0) {
    return null;
  }
  const answer = (handle: string, accept: boolean) => {
    setBusy(handle);
    friendsService
      .answerRequest(handle, accept)
      .then(() => {
        setRequests((current) => current.filter((request) => request.handle !== handle));
        showToast(accept ? `${at(handle)} follows you now.` : "Declined.");
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(null));
  };
  return (
    <div className="mt-5 border-t border-outline-variant/40 pt-4">
      <p className={EYEBROW}>Asking to follow you</p>
      <ul className="mt-2 flex flex-col gap-2">
        {requests.map((request) => (
          <li key={request.handle} className="flex flex-wrap items-center gap-3">
            <PipAvatar seed={request.pipSeed} avatar={request.avatar} size={30} />
            <span className="min-w-0 flex-1 truncate text-sm text-on-surface">
              {request.displayName ?? at(request.handle)} <span className="text-xs text-on-surface-variant">{at(request.handle)}</span>
            </span>
            <span className="flex gap-2">
              <button type="button" className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60" disabled={busy !== null} onClick={() => answer(request.handle, false)}>
                Decline
              </button>
              <button
                type="button"
                className="tactile-button tactile-button-primary px-3 py-1.5 text-xs disabled:opacity-60"
                disabled={busy !== null}
                onClick={() => answer(request.handle, true)}
              >
                Accept
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** The readers this one has blocked, with a way back. Nothing is drawn when there are none. */
const BlockedReaders = ({ showToast }: { showToast: (message: string) => void }) => {
  const [blocked, setBlocked] = useState<CommunityPerson[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    discussService
      .blocked()
      .then((found) => live && setBlocked(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (blocked.length === 0) {
    return null;
  }
  const unblock = (handle: string) => {
    setBusy(handle);
    discussService
      .unblock(handle)
      .then(() => {
        setBlocked((current) => current.filter((reader) => reader.handle !== handle));
        showToast(`${at(handle)} is unblocked.`);
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(null));
  };
  return (
    <div className="mt-5 border-t border-outline-variant/40 pt-4">
      <p className={EYEBROW}>Blocked</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {blocked.map((reader) => (
          <li key={reader.handle} className="flex items-center gap-2 rounded-full bg-surface-container-high py-1 pl-3 pr-1 text-xs text-on-surface">
            {at(reader.handle)}
            <button type="button" className="tactile-button px-2.5 py-1 text-[11px] disabled:opacity-60" disabled={busy !== null} onClick={() => unblock(reader.handle)}>
              Unblock
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * You, as other readers see you: the one place for your Pip, name, handle and
 * the switch that matters, private (the default; nothing is shared), kept to
 * followers (found by handle, read only by the readers you accept) or public
 * (on the board, visible by handle). Either of the last two can follow, send
 * kudos and duel.
 *
 * Settings keeps the account itself (email, password); everything that
 * appears on the board is edited here.
 */
export const ProfileCard = ({ profile, loadError = null, onRetry, handleNudge = 0, onSaved, showToast, onOpenPip }: ProfileCardProps) => {
  const account = useAccountStore((state) => state.status.account);
  const saveAvatar = useAccountStore((state) => state.setAvatar);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState(() => account?.avatar ?? randomAvatar().id);
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleField = useRef<HTMLInputElement | null>(null);
  const nudgeAnswered = useRef(0);

  // Asked to share from the board with no handle: show where to pick one.
  // Two passes: the first opens the fields, the second (once they are on
  // screen) brings the Handle field into view and puts the cursor in it.
  useEffect(() => {
    if (handleNudge === 0 || handleNudge === nudgeAnswered.current) {
      return;
    }
    if (panel !== "details") {
      setPanel("details");
      return;
    }
    nudgeAnswered.current = handleNudge;
    handleField.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    handleField.current?.focus({ preventScroll: true });
  }, [handleNudge, panel]);

  // The name given at sign-up seeds a new profile's, so there is one name, not two.
  useEffect(() => {
    setHandle(profile?.handle ?? "");
    setDisplayName(nameToEdit(profile, account?.displayName));
  }, [profile?.handle, profile?.displayName, account?.displayName]);

  // A reader without a handle has nothing to show yet: start with the fields open.
  useEffect(() => {
    if (profile && !profile.handle) {
      setPanel((current) => (current === "none" ? "details" : current));
    }
  }, [profile]);

  const isPublic = profile?.visibility === "public";
  // Shared with everyone, or kept to followers: on the server either way.
  const shared = profile?.visibility === "public" || profile?.visibility === "followers";
  // As other readers see it: a profile with a handle and no name goes by the handle.
  const name = profile?.displayName || (profile?.handle ? at(profile.handle) : account?.displayName || "Your profile");

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
    const invite = `Add me on Leaflet: ${at(profile.handle)} (Social → Board → Find readers)`;
    navigator.clipboard
      .writeText(invite)
      .then(() => showToast("Copied. Send it to a friend."))
      .catch(() => showToast(`Your handle is ${at(profile.handle)}.`));
  };

  // Whether the readers who follow this one may see its whole library.
  const shareLibrary = (on: boolean) => {
    setBusy(true);
    setError(null);
    socialService
      .saveProfile({ handle: profile?.handle ?? null, visibility: profile?.visibility, shareLibrary: on })
      .then((saved) => {
        onSaved(saved);
        showToast(on ? "Your library is visible to the readers who follow you." : "Your library is yours alone again.");
      })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const save = (visibility?: ProfileVisibility) => {
    setBusy(true);
    setError(null);
    socialService
      .saveProfile({
        // Making a profile private is never held up by a handle that was
        // half-typed in the field: the handle is then left as it is.
        handle: (visibility === "private" && handleFault ? "" : handle) || null,
        // Sent even when empty: an empty name removes it. Sent as "nothing",
        // it was left as it was, and the card said "Saved." all the same.
        displayName: displayName.trim(),
        // Left out when it is not being changed and is not known (the profile
        // did not load): defaulting to "private" here un-shared a shared
        // reader who only meant to fix their name.
        visibility: visibility ?? profile?.visibility
      })
      .then((saved) => {
        onSaved(saved);
        // The name by the avatar in the sidebar is the account's, which the
        // save has just brought into line: show it without a restart.
        void useAccountStore.getState().load();
        if (!visibility) {
          setPanel("none");
        }
        showToast(
          visibility === "public"
            ? COPY.sharedToast
            : visibility === "private"
              ? COPY.privateToast
              : visibility === "followers"
                ? "Kept to followers: readers ask, and you say who."
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

  const needsHandle = !shared && handle.length === 0;
  // The same rule the sign-up form and the server apply, said before saving.
  const handleFault = handle ? handleProblem(handle) : null;
  // Until the profile has been read, whether it is shared is not known, and
  // saying "Private" (as this card did) told a shared reader the wrong thing.
  const unknown = profile === null;

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
            {unknown ? (
              loadError ? COPY.profileFailed : COPY.profileLoading
            ) : shared ? (
              <>
                {isPublic ? "Shared as " : "Kept to followers as "}
                <span className="font-semibold text-on-surface">{at(profile?.handle)}</span>
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
          {shared && profile?.handle && (
            <button type="button" className="tactile-button flex items-center gap-1.5 px-4 py-2 text-xs" onClick={copyInvite} title="Copies a line with your handle to send to a friend">
              <Copy size={13} aria-hidden />
              Copy invite
            </button>
          )}
          {/* Who may see the profile: one of three, the one in force pressed. */}
          <span className="flex" role="group" aria-label="Who can see your profile">
            {WAYS.map((way, index) => {
              const on = profile?.visibility === way.id;
              return (
                <button
                  key={way.id}
                  type="button"
                  aria-pressed={on}
                  className={`tactile-button px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${on ? "tactile-button-primary" : ""} ${
                    index === 0 ? "rounded-r-none" : index === WAYS.length - 1 ? "rounded-l-none" : "rounded-none"
                  }`}
                  onClick={() => !on && save(way.id)}
                  disabled={busy || unknown || (way.id !== "private" && (needsHandle || Boolean(handleFault && !shared)))}
                  title={way.id !== "private" && needsHandle && !unknown ? "Pick a handle first" : way.hint}
                >
                  {way.label}
                </button>
              );
            })}
          </span>
        </div>
      </div>

      {unknown ? (
        loadError && (
          <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">
            <span>{loadError}</span>
            {onRetry && (
              <button type="button" className="tactile-button px-3 py-1 text-xs" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )
      ) : (
        <p className="mt-3 max-w-prose text-xs leading-5 text-on-surface-variant">
          {isPublic
            ? "Your Pip, name, handle, streak, weekly minutes, shelf, the book you have open, level and badges are visible to other readers."
            : shared
              ? "Other readers see only your Pip, name and handle until you accept them. You are not on the public board."
              : "Nobody else can see you, and you are not on the board. Share your profile to appear there and to follow, send kudos and duel."}
        </p>
      )}

      {shared && profile && (
        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-on-surface" title="The titles and authors of your books, and how far you are in each. Never the files.">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[rgb(var(--color-primary))]"
            checked={Boolean(profile.sharesLibrary)}
            disabled={busy}
            onChange={(event) => shareLibrary(event.target.checked)}
          />
          Readers who follow me can see my library
        </label>
      )}

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
              <HandleField inputRef={handleField} value={handle} onChange={setHandle} invalid={Boolean(handleFault)} />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-on-surface-variant">
            {handleFault ?? (handle ? `Other readers find you as ${at(handle)}.` : COPY.handleHint)}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => save()}
              disabled={busy || Boolean(handleFault)}
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

      {profile?.visibility === "followers" && <FollowRequests showToast={showToast} />}
      {shared && <BlockedReaders showToast={showToast} />}

      {shared && profile && panel === "none" && (
        <div className="mt-5 border-t border-outline-variant/40 pt-4">
          <p className={EYEBROW}>Your shelf, as others see it</p>
          <div className="mt-3">
            <SharedShelf shelf={profile.shelf} emptyText="Your shelf fills as you read." />
          </div>
        </div>
      )}
    </section>
  );
};
