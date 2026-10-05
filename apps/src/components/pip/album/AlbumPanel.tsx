import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RARITIES, RARITY_NAME, timesText, type Album, type AlbumEntry } from "../../../pip/expedition";
import { FindSprite } from "./FindSprite";
import { gridStep, isGridKey } from "./gridKeys";
import { countText, entryLabel, firstFoundText, tallyText, titleOf, whereText } from "./words";
import "./album.css";

type AlbumPanelProps = {
  /** The album to show (`useAlbum()`, or `buildAlbum(sessions)`). */
  album: Album;
  /** The library's titles by book id, so a find names its book as the library does now. */
  bookTitles?: ReadonlyMap<string, string>;
  /** The find to open on; the newest find when none is given. */
  initial?: string | null;
  /** "hud": drawn in the HUD's inks, for a card over Pip's room. The app's paper otherwise. */
  skin?: "hud";
};

/**
 * Pip's album: everything she can bring back from an expedition, a row for
 * each rarity. What has been found is drawn, with how many times; what has
 * not is its shape only, and each row says how many are left. The thing
 * selected shows its name, her line about it, and when and in which session
 * it was first found.
 *
 * The grid is one tab stop: the arrow keys move through it (up and down to
 * the nearest thing in the next row), Home and End go to its ends, and the
 * thing in focus is the thing shown.
 */
export const AlbumPanel = ({ album, bookTitles, initial, skin }: AlbumPanelProps) => {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [chosen, setChosen] = useState<string | null>(initial ?? album.finds[0]?.find.id ?? null);
  const byRarity = useMemo(
    () => RARITIES.map((rarity) => album.entries.filter((entry) => entry.find.rarity === rarity)),
    [album.entries]
  );
  const selected: AlbumEntry | null = album.entries.find((entry) => entry.find.id === chosen) ?? null;
  // The one tab stop: the thing selected, or the first thing while nothing is.
  const tabStop = selected?.find.id ?? album.entries[0]?.find.id;

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isGridKey(event.key)) {
      return;
    }
    event.preventDefault();
    const keys = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>(".pip-album-thing") ?? []);
    const to = gridStep(
      event.key,
      keys.map((key) => key.getBoundingClientRect()),
      keys.indexOf(event.currentTarget)
    );
    const next = to === null ? undefined : keys[to];
    if (next) {
      // Chosen here as well as by its focus: a window that is not in front sends no focus events.
      setChosen(next.dataset.find ?? null);
      next.focus();
    }
  };

  return (
    <div className="pip-album" data-skin={skin}>
      <div className="pip-album-main">
        <p className="pip-album-count" aria-live="polite">
          <strong className="tabular-nums">
            {album.found} of {album.total}
          </strong>{" "}
          found
          {album.trips > 0 && (
            <span className="pip-album-trips">
              {" "}
              · {album.trips} {album.trips === 1 ? "trip" : "trips"} out
            </span>
          )}
        </p>
        {album.trips === 0 && (
          <p className="pip-line pip-album-empty">nothing yet. start a focus session and i'll go and look.</p>
        )}

        <div ref={gridRef} className="pip-album-rows">
          {byRarity.map((entries, row) => {
            const rarity = RARITIES[row];
            const tally = album.byRarity[row];
            return (
              <section key={rarity} className="pip-album-row" data-rarity={rarity} aria-labelledby={`pip-album-${rarity}`}>
                <h3 id={`pip-album-${rarity}`} className="pip-album-rarity">
                  <span className="pip-album-gem" aria-hidden="true" />
                  {RARITY_NAME[rarity]}
                  <span className="pip-album-tally tabular-nums">{tallyText(tally)}</span>
                </h3>
                <div className="pip-album-grid" role="group" aria-labelledby={`pip-album-${rarity}`}>
                  {entries.map((entry) => {
                    const found = entry.count > 0;
                    return (
                      <button
                        key={entry.find.id}
                        type="button"
                        className="pip-album-thing"
                        data-found={found || undefined}
                        data-find={entry.find.id}
                        aria-pressed={entry.find.id === chosen}
                        aria-label={entryLabel(entry)}
                        tabIndex={entry.find.id === tabStop ? 0 : -1}
                        onClick={() => setChosen(entry.find.id)}
                        onFocus={() => setChosen(entry.find.id)}
                        onKeyDown={onKey}
                      >
                        <FindSprite id={entry.find.id} box={48} found={found} />
                        {entry.count > 1 && <span className="pip-album-times tabular-nums">{timesText(entry.count)}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <p className="pip-album-rule">
          Pip goes out when a focus session starts and comes back when it ends. Five minutes or more of reading and she
          brings something back. The longer the session, the further she gets and the rarer what she finds; a session
          read to the end without leaving the book takes her half as far again.
        </p>
      </div>

      <aside className="pip-album-detail" aria-live="polite" aria-label="The thing selected">
        {!selected ? (
          <p className="pip-album-detail-empty">Select a thing to see what Pip made of it.</p>
        ) : selected.count > 0 && selected.first ? (
          <>
            <div className="pip-album-detail-art" data-rarity={selected.find.rarity}>
              <FindSprite id={selected.find.id} box={96} className="pip-album-art-large" />
              <FindSprite id={selected.find.id} box={60} className="pip-album-art-small" />
            </div>
            <div className="pip-album-detail-text">
              <h3 className="pip-album-name">{titleOf(selected.find.name)}</h3>
              <p className="pip-album-chip" data-rarity={selected.find.rarity}>
                <span className="pip-album-gem" aria-hidden="true" />
                {RARITY_NAME[selected.find.rarity]}
                {selected.count > 1 && <span className="tabular-nums"> · {timesText(selected.count)}</span>}
              </p>
              <p className="pip-line pip-album-line">{selected.find.line}</p>
              <p className="pip-album-when">{firstFoundText(selected.first, bookTitles)}</p>
              <p className="pip-album-when">{countText(selected.count)}</p>
            </div>
          </>
        ) : (
          <>
            <div className="pip-album-detail-art" data-rarity={selected.find.rarity}>
              <FindSprite id={selected.find.id} box={96} found={false} className="pip-album-art-large" />
              <FindSprite id={selected.find.id} box={60} found={false} className="pip-album-art-small" />
            </div>
            <div className="pip-album-detail-text">
              <h3 className="pip-album-name">Not found yet</h3>
              <p className="pip-album-chip" data-rarity={selected.find.rarity}>
                <span className="pip-album-gem" aria-hidden="true" />
                {RARITY_NAME[selected.find.rarity]}
              </p>
              <p className="pip-album-when">{whereText(selected.find.rarity)}</p>
            </div>
          </>
        )}
      </aside>
    </div>
  );
};
