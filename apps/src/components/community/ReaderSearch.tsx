import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { UiIcon } from "../UiIcon";
import { socialService, type SearchResult } from "../../services/socialService";
import { useCommunityStore } from "./communityStore";
import { PipAvatar } from "./PipAvatar";
import { at, errorText, gentleError, minutesText, nameOf } from "./format";
import { HandleField } from "./HandleField";
import { SectionHeader } from "../ui/SectionHeader";

const DEBOUNCE_MS = 300;

/** What has become of following one reader from the list: asked, followed, or asked for and waiting on them. */
type Asked = "busy" | "following" | "requested";

/**
 * Adding friends, in one place: your own handle to send to them, a search by
 * the start of theirs (debounced; ten at most), and Follow beside each one
 * found. A profile kept to followers is asked instead, and they answer in
 * their inbox. Choosing a reader's name opens their card, as before.
 *
 * It used to be a search alone, at the foot of the Board tab, whose results
 * had to be opened to find a Follow button: the owner looked under Friends
 * and found no way to send a request (2026-10-14).
 */
export const ReaderSearch = ({ showToast }: { showToast?: (message: string) => void }) => {
  const openReader = useCommunityStore((state) => state.openReader);
  const me = useCommunityStore((state) => state.me);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<Record<string, Asked>>({});
  const toast = showToast ?? (() => undefined);

  useEffect(() => {
    const q = query;
    if (!q) {
      setResults(null);
      setError(null);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      socialService
        .search(q)
        .then((found) => {
          if (live) {
            setResults(found);
            setError(null);
          }
        })
        .catch((cause) => live && setError(errorText(cause)));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const mine = me?.handle && me.visibility !== "private" ? me.handle : null;
  const copyHandle = () => {
    if (!mine) {
      return;
    }
    navigator.clipboard
      .writeText(`Follow me on Leaflet: ${at(mine)}`)
      .then(() => toast("Copied. Send it to a friend."))
      .catch(() => toast(`You are ${at(mine)}.`));
  };

  const follow = (handle: string) => {
    setAsked((was) => ({ ...was, [handle]: "busy" }));
    socialService
      .setFollowing(handle, true)
      .then((result) => {
        const now: Asked = result.following ? "following" : "requested";
        setAsked((was) => ({ ...was, [handle]: now }));
        toast(now === "following" ? `You follow ${at(handle)}.` : `Asked ${at(handle)}. They answer in their inbox.`);
      })
      .catch((cause) => {
        setAsked((was) => {
          const next = { ...was };
          delete next[handle];
          return next;
        });
        toast(gentleError(errorText(cause)));
      });
  };

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="find-title">
      <SectionHeader eyebrow="Follow readers" title="Add friends" id="find-title" />
      {mine && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
          <span>
            You are <span className="font-semibold text-on-surface">{at(mine)}</span>
          </span>
          <button
            type="button"
            className="tactile-button inline-flex items-center gap-1 px-2.5 py-1 text-[11px]"
            onClick={copyHandle}
            title="Copy your handle, to send to a friend so they can follow you"
          >
            <Copy size={12} aria-hidden /> Copy
          </button>
        </div>
      )}
      <div className="relative mt-4">
        <UiIcon name="search" size={17} className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-on-surface-variant" />
        {/* The "@" is drawn in the field (typing one is fine too): what is searched is the handle. */}
        <HandleField
          value={query}
          onChange={setQuery}
          ariaLabel="Find a reader by their handle"
          placeholder="their handle"
          indent="pl-[3.25rem]"
          atClassName="left-9"
          wrapperClassName=""
        />
      </div>
      {error && <p className="mt-3 text-xs text-on-surface-variant">{gentleError(error)}</p>}
      {results && results.length === 0 && !error && (
        <p className="mt-3 text-xs text-on-surface-variant">No shared profile starts with {at(query)}. Private profiles don't show up.</p>
      )}
      {results && results.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {results.map((result) => {
            const state = asked[result.handle];
            const self = result.handle === me?.handle;
            return (
              <li key={result.handle} className="flex list-none items-center gap-2 rounded-lg pr-1 hover:bg-surface-container-high/60">
                <button
                  type="button"
                  onClick={() => openReader(result.handle)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left"
                  title="Open their card"
                >
                  <PipAvatar seed={result.pipSeed} avatar={result.avatar} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-on-surface">{nameOf(result)}</span>
                    <span className="block truncate text-xs text-on-surface-variant">
                      {at(result.handle)} · {minutesText(result.weekMinutes)} this week
                    </span>
                  </span>
                </button>
                {!self && (
                  <button
                    type="button"
                    className={`tactile-button shrink-0 px-3 py-1.5 text-xs ${state ? "" : "tactile-button-primary"}`}
                    disabled={Boolean(state)}
                    aria-label={state === "following" ? `You follow ${at(result.handle)}` : state === "requested" ? `Asked to follow ${at(result.handle)}` : `Follow ${at(result.handle)}`}
                    onClick={() => follow(result.handle)}
                  >
                    {state === "busy" ? "…" : state === "following" ? "Following" : state === "requested" ? "Asked" : "Follow"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
