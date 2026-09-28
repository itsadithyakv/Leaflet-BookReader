import { useEffect, useState } from "react";
import { UiIcon } from "../UiIcon";
import { socialService, type SearchResult } from "../../services/socialService";
import { useCommunityStore } from "./communityStore";
import { PipAvatar } from "./PipAvatar";
import { at, errorText, minutesText, nameOf } from "./format";

const DEBOUNCE_MS = 300;

/** Find public readers by the start of their handle. Debounced; ten at most. */
export const ReaderSearch = () => {
  const openReader = useCommunityStore((state) => state.openReader);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim().replace(/^@/, "");
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

  return (
    <section className="paper-surface rounded-xl p-6" aria-labelledby="find-title">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">Visit a shelf</p>
      <h2 id="find-title" className="page-title mt-2 text-2xl">
        Find readers
      </h2>
      <div className="relative mt-4">
        <UiIcon name="search" size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value.toLowerCase())}
          placeholder="Search by handle"
          aria-label="Search readers by handle"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={25}
          className="inset-field w-full py-2 pl-10 pr-3 text-sm text-on-surface"
        />
      </div>
      {error && <p className="mt-3 text-xs text-on-surface-variant">{error}</p>}
      {results && results.length === 0 && !error && (
        <p className="mt-3 text-xs text-on-surface-variant">No public reader starts with “{query.trim()}”. Private profiles don't show up.</p>
      )}
      {results && results.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {results.map((result) => (
            <li key={result.handle} className="list-none">
              <button
                type="button"
                onClick={() => openReader(result.handle)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-container-high/60"
              >
                <PipAvatar seed={result.pipSeed} avatar={result.avatar} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-on-surface">{nameOf(result)}</span>
                  <span className="block truncate text-xs text-on-surface-variant">{at(result.handle)}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-on-surface-variant">{minutesText(result.weekMinutes)} this week</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
