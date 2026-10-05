import { useEffect, useState } from "react";

/** The same question the stylesheets ask (tailwind's `touch`): no hover, and a finger for a pointer. */
const QUERY = "(hover: none) and (pointer: coarse)";

const asks = () => {
  try {
    return window.matchMedia(QUERY);
  } catch {
    return null;
  }
};

/**
 * Whether the hand is a finger: for what is sized from script (the press
 * areas of the things in Pip's room, how many stops her lift has room for),
 * where a stylesheet's media query cannot reach. Follows a change (a tablet
 * taken off its keyboard).
 */
export const useCoarsePointer = () => {
  const [coarse, setCoarse] = useState(() => asks()?.matches ?? false);
  useEffect(() => {
    const query = asks();
    if (!query) return;
    const changed = () => setCoarse(query.matches);
    changed();
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return coarse;
};
