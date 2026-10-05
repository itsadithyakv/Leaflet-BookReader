import { useMemo } from "react";
import { useHabitStore } from "../../../store/habitStore";
import { buildAlbum, type Album } from "../../../pip/expedition";

/**
 * Pip's album as the shelf makes it now. Worked out from the focus sessions
 * in the habit snapshot every time they change: there is nothing stored to
 * load, and a session that arrives by sync shows its find at once.
 */
export const useAlbum = (): Album => {
  const sessions = useHabitStore((state) => state.snapshot.sessions);
  return useMemo(() => buildAlbum(sessions), [sessions]);
};
