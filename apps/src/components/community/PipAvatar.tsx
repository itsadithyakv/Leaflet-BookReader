import { PipSprite } from "../PipSprite";
import { parseAvatar } from "../../pip/avatars";
import { skinFor } from "./format";

type PipAvatarProps = {
  /** The reader's pip seed (their handle). Picks the skin when they have no avatar. */
  seed: string | null | undefined;
  /** The avatar they picked (`skin.move`, or `skin.move.acc+acc` for their own Pip). Unknown or missing falls back to the seed. */
  avatar?: string | null;
  size?: number;
  /**
   * `true` plays the avatar's signature move (idle for readers without one),
   * `"idle"` just breathes, and false (the default) holds a still pose.
   */
  play?: boolean | "idle";
  /** A specific move to play, overriding the signature one. */
  move?: string;
  label?: string;
  className?: string;
};

/**
 * The skin, signature move and outfit a reader's Pip wears: from their avatar
 * (a catalogue pick or their own Pip from the Pip tab), or a skin from their
 * seed.
 */
export const avatarLook = (seed: string | null | undefined, avatar?: string | null) =>
  parseAvatar(avatar) ?? { skin: skinFor(seed), move: "idle", outfit: [] as string[] };

/**
 * A reader's face on the board: Pip, in the avatar they picked, or in a skin
 * chosen from their handle if they never picked one.
 *
 * Still by default — a hundred dancing Pips on one board is a casino, not a
 * reading room. The still pose is the signature move's own, so two avatars in
 * the same skin still look different. Callers bring one to life on hover, or
 * on the reader card.
 *
 * Pip is drawn as a portrait, to fill the round frame. It used to be the whole
 * 32px sprite at 86% of the frame, rounded down to whole pixels: at 125% and
 * 150% display scaling that left a small Pip in the middle of an empty disc.
 */
export const PipAvatar = ({ seed, avatar, size = 40, play = false, move, label, className }: PipAvatarProps) => {
  const look = avatarLook(seed, avatar);
  const playing = Boolean(move) || play !== false;
  const shown = move ?? (play === "idle" ? "idle" : look.move);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high/70 ring-1 ring-outline-variant/40 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <PipSprite move={shown} still={!playing} size={size} portrait skin={look.skin} outfit={look.outfit} label={label} />
    </span>
  );
};
