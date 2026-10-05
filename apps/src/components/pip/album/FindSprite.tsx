import { renderFind, renderFindSilhouette } from "../../../pip/expedition-art.js";
import { PixelImage } from "../PixelImage";

type FindSpriteProps = {
  /** The find's id (pip/expedition.ts). */
  id: string;
  /** The box to fit in, in CSS pixels. */
  box: number;
  /** False draws its shape only: a thing not found yet. */
  found?: boolean;
  /** Read out in place of the picture; without one the picture is decoration. */
  label?: string;
  className?: string;
};

/**
 * One of the things Pip brings back, drawn crisp at a whole number of device
 * pixels per art pixel. A still: the first frame, so the album does not need
 * a clock (the house, which has one, calls `renderFind` with its own frame).
 *
 * The art needs the room's Painter, which loads with the Pip tab and not with
 * the app: a caller outside the Pip tab imports this file lazily.
 */
export const FindSprite = ({ id, box, found = true, label, className }: FindSpriteProps) => (
  <PixelImage
    render={() => (found ? renderFind(id, 0) : renderFindSilhouette(id, "#6b5f4a66"))}
    drawKey={`find-${id}-${found ? "found" : "shape"}`}
    box={box}
    label={label}
    className={className}
  />
);

export default FindSprite;
