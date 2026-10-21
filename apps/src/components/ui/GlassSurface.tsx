// <GlassSurface>: content on its own liquid glass, after React Bits' component
// of the same name (see glassRefraction.ts for how it bends and where).
// Where the bend cannot be drawn, or `refraction` is off, it is frosted glass
// with a sheen and a rim instead.

import { useRef, type CSSProperties, type ReactNode } from "react";
import { glassCanRefract, useGlassRefraction, type GlassBend } from "./glassRefraction";
import { usePerfTier } from "../../platform/perfTier";
import "./glassSurface.css";

export type GlassSurfaceProps = GlassBend & {
  children?: ReactNode;
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  refraction?: boolean;
  /** Opacity of a soft frosted tint over the glass, 0 to 1. */
  backgroundOpacity?: number;
  /** Saturation of what is seen through the glass. */
  saturation?: number;
  className?: string;
  style?: CSSProperties;
};

const toLength = (value: number | string) => (typeof value === "number" ? `${value}px` : value);

export default function GlassSurface({
  children,
  width = 200,
  height = 80,
  borderRadius = 20,
  refraction = true,
  backgroundOpacity = 0,
  saturation = 1,
  className = "",
  style,
  ...bend
}: GlassSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tier = usePerfTier();
  const refracts = refraction && tier === "full" && glassCanRefract();
  useGlassRefraction(ref, bend, refracts);

  const containerStyle = {
    ...style,
    width: toLength(width),
    height: toLength(height),
    borderRadius: `${borderRadius}px`,
    "--glass-frost": backgroundOpacity,
    "--glass-saturation": saturation,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={`glass-surface ${refracts ? "glass-surface--svg" : "glass-surface--fallback"} ${className}`.trim()}
      style={containerStyle}
    >
      {!refracts && <span className="glass-surface__sheen" aria-hidden="true" />}
      {!refracts && <span className="glass-surface__rim" aria-hidden="true" />}
      <div className="glass-surface__content">{children}</div>
    </div>
  );
}
