import { useEffect, useRef, useState } from "react";

/** Whole device pixels per art pixel that fit the box, never fewer than one. */
export const pixelsPerArtPixel = (artWidth: number, artHeight: number, boxWidth: number, boxHeight: number) => {
  const ratio = window.devicePixelRatio || 1;
  return Math.max(1, Math.floor(Math.min((boxWidth * ratio) / artWidth, (boxHeight * ratio) / artHeight) + 1e-6));
};

type PixelImageProps = {
  /** Draws the art; null when there is none yet (the tile shows nothing). */
  render: () => ImageData | null;
  /** Changing this redraws. */
  drawKey: string;
  /** The box to fit in, in CSS pixels. */
  box: number;
  label?: string;
  className?: string;
};

/**
 * A still piece of pixel art (a room item, a room style) at a whole number of
 * device pixels per art pixel, like PipSprite, so it stays crisp at 125% and
 * 150% display scaling. The canvas holds the art at its own size and CSS
 * scales it with `image-rendering: pixelated`.
 */
export const PixelImage = ({ render, drawKey, box, label, className }: PixelImageProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = render();
    if (!canvas || !image) {
      setSize(null);
      return;
    }
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
    // Whole device pixels per art pixel when the art fits at least once;
    // a big piece (a whole room as a thumbnail) is scaled down instead, where
    // nearest-neighbour sampling only drops pixels rather than blurring.
    const ratio = window.devicePixelRatio || 1;
    const exact = Math.min((box * ratio) / image.width, (box * ratio) / image.height);
    const per = exact >= 1 ? pixelsPerArtPixel(image.width, image.height, box, box) : exact;
    setSize({ w: (image.width * per) / ratio, h: (image.height * per) / ratio });
    // `render` is a fresh closure every render; drawKey says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawKey, box]);

  return (
    <canvas
      ref={canvasRef}
      className={`pip-sprite ${className ?? ""}`}
      style={size ? { width: size.w, height: size.h } : { display: "none" }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
};
