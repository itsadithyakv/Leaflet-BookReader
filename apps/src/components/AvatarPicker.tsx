import { useRef, useState, type KeyboardEvent } from "react";
import { AVATARS, avatarById, parseAvatar } from "../pip/avatars";
import { PipSprite } from "./PipSprite";

type AvatarPickerProps = {
  /** The chosen avatar id (`skin.move`). */
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
};

/**
 * Pick your Pip: a grid of avatars with the chosen one shown large, name and
 * all.
 *
 * The grid stays calm: a tile only plays its move while hovered, focused or
 * chosen, so at most a couple of sprites animate at once (they share one 12 fps
 * ticker either way). A radiogroup: Tab lands on the chosen tile, arrows move
 * the choice, Home/End jump to the ends.
 */
export const AvatarPicker = ({ value, onChange, disabled = false, label = "Avatar" }: AvatarPickerProps) => {
  const [hot, setHot] = useState<string | null>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  // The reader's own Pip (set from the Pip tab) is not one of the tiles: it is
  // shown as the current choice until a tile replaces it.
  const own = avatarById(value) ? null : parseAvatar(value);
  const chosen = avatarById(value) ?? (own ? null : AVATARS[0]);
  const index = chosen ? AVATARS.findIndex((avatar) => avatar.id === chosen.id) : -1;

  // The grid reflows with the card's width, so Up/Down step by however many
  // tiles actually share the first row.
  const columns = () => {
    const top = tiles.current[0]?.offsetTop;
    return Math.max(1, tiles.current.filter((tile) => tile && tile.offsetTop === top).length);
  };

  const choose = (to: number) => {
    onChange(AVATARS[to].id);
    tiles.current[to]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = AVATARS.length - 1;
    let to: number | null = null;
    if (event.key === "ArrowRight") to = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft") to = index <= 0 ? last : index - 1;
    if (event.key === "ArrowDown") to = Math.min(last, index + columns());
    if (event.key === "ArrowUp") to = Math.max(0, index - columns());
    if (event.key === "Home") to = 0;
    if (event.key === "End") to = last;
    if (to !== null) {
      event.preventDefault();
      choose(to);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4">
        <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-surface-container-high/70 ring-1 ring-outline-variant/40">
          {chosen ? (
            <PipSprite move={chosen.move} skin={chosen.skin} size={80} snap="nearest" />
          ) : (
            own && <PipSprite move={own.move} skin={own.skin} outfit={own.outfit} size={80} snap="nearest" />
          )}
        </span>
        <div className="min-w-0" aria-live="polite">
          <p className="font-headline text-lg font-bold text-on-surface">{chosen ? chosen.name : "Your Pip"}</p>
          <p className="text-xs text-on-surface-variant">{chosen ? chosen.blurb : "dressed up on the Pip tab"}</p>
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="mt-3 grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(3rem, 1fr))" }}
      >
        {AVATARS.map((avatar, i) => {
          const checked = avatar.id === chosen?.id;
          return (
            <button
              key={avatar.id}
              ref={(element) => {
                tiles.current[i] = element;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${avatar.name}: ${avatar.blurb}`}
              title={avatar.name}
              tabIndex={checked || (index < 0 && i === 0) ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(avatar.id)}
              onKeyDown={onKeyDown}
              onMouseEnter={() => setHot(avatar.id)}
              onMouseLeave={() => setHot((current) => (current === avatar.id ? null : current))}
              onFocus={() => setHot(avatar.id)}
              onBlur={() => setHot((current) => (current === avatar.id ? null : current))}
              className={`flex aspect-square items-center justify-center overflow-hidden rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                checked
                  ? "bg-primary/15 ring-2 ring-primary"
                  : "bg-surface-container-high/50 ring-1 ring-outline-variant/40 hover:bg-surface-container-high"
              }`}
            >
              {/* A portrait, like the profile picture it becomes: Pip fills the tile (48px at its narrowest). */}
              <PipSprite move={avatar.move} skin={avatar.skin} size={44} portrait still={!(checked || hot === avatar.id)} />
            </button>
          );
        })}
      </div>
    </div>
  );
};
