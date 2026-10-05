import { useEffect, useMemo, useRef } from "react";
import { VisitorNote, VisitorPip, type VisitorEvent, type VisitorFrame } from "./VisitorPip";
import { useCommunityStore } from "../community/communityStore";
import { stubVisit, useVisitorStore, useVisitors } from "../../pip/useVisitors";
import { defaultDoor, hostOf, standAt, type Door, type VisitorCandidate } from "../../pip/visitors";

/** The room as `HouseScene` hands it to an overlay (`RoomFrame`): the visitor's part of it, and how Pip is. */
export type VisitorsFrame = VisitorFrame & {
  pip?: () => { x: number; phase?: string; away?: boolean };
};

type VisitorsProps = {
  frame: VisitorsFrame;
  /** Where visitors come in and leave. The right-hand wall when left out. */
  door?: Door;
  /** What stands on the floor line (left edge and width, floor pixels), for the visitor to keep clear of. Pip is counted already. */
  taken?: ReadonlyArray<{ x: number; w: number }>;
  /** The room is taken up with something else (decorating, the arcade): no knock for now. */
  busy?: boolean;
  /** Pip is out (an expedition): a friend who comes leaves a note. Also read from `frame.pip().away` when the frame says. */
  away?: boolean;
  /** A knock, the visitor reaching its place, the visitor gone: for Pip to answer. */
  onEvent?: (event: VisitorEvent) => void;
  /** Takes the reader to that profile on the Social page. Left out, the card has no such button. */
  onOpenProfile?: (handle: string) => void;
};

/** Makes the Social page open on the community, with this reader's card showing. The caller then shows the page. */
export const prepareVisitorProfile = (handle: string) => {
  try {
    localStorage.setItem("leaflet.social.view", "community");
  } catch {
    // The page opens on whichever half it was last on.
  }
  useCommunityStore.getState().openReader(handle);
};

/**
 * Visitors in Pip's house, whole: runs the day's visits while it is mounted
 * (`useVisitors`), and draws whoever is here (`VisitorPip`) or the note they
 * left (`VisitorNote`). One element for the house to mount in the room box;
 * with community off, signed out, a private profile, nothing read today or no
 * friend who has read, it draws nothing and asks nothing of anyone.
 */
export const Visitors = ({ frame, door, taken, busy = false, away = false, onEvent, onOpenProfile }: VisitorsProps) => {
  const live = useRef({ frame, busy, away });
  live.current = { frame, busy, away };
  useVisitors(() => {
    const pip = live.current.frame.pip?.();
    return hostOf(live.current.away ? { ...pip, away: true } : pip, live.current.busy);
  });

  const visit = useVisitorStore((state) => state.visit);
  const note = useVisitorStore((state) => state.note);
  const report = useVisitorStore((state) => state.report);
  const readNote = useVisitorStore((state) => state.readNote);
  const way = useMemo(() => door ?? defaultDoor(frame.w), [door, frame.w]);

  // The place is chosen once, as the visitor knocks: clear of where Pip is then and of the furniture.
  const from = visit?.record.from ?? null;
  const spot = useMemo(() => {
    if (from === null) {
      return null;
    }
    const pip = live.current.frame.pip?.();
    return standAt(frame.w, way, [...(pip ? [{ x: pip.x - 16, w: 32 }] : []), ...(taken ?? [])]);
    // `taken` is read when the visit begins; furniture moved mid-visit does not move the visitor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, frame.w, way]);

  // For the preview, where there is no server: `window.__pipVisitors.stub()`.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const hook = {
      /** Puts a visitor in the house for `stayMs` (or a note on the door). */
      stub: (visitor: Partial<VisitorCandidate> = {}, stayMs = 60_000, kind: "visit" | "note" = "visit") =>
        stubVisit({ handle: "maya", displayName: "Maya", pipSeed: "maya", avatar: "wizard.magic", weekMinutes: 95, streak: 7, ...visitor }, stayMs, kind),
      clear: () => useVisitorStore.setState({ visit: null, note: null, phase: null, presence: "none", standing: null }),
      state: () => {
        const { visit: who, note: left, phase, presence, standing } = useVisitorStore.getState();
        return { visit: who, note: left, phase, presence, standing };
      }
    };
    (window as unknown as { __pipVisitors?: typeof hook }).__pipVisitors = hook;
    return () => {
      delete (window as unknown as { __pipVisitors?: typeof hook }).__pipVisitors;
    };
  }, []);

  return (
    <>
      {visit && spot !== null && (
        <VisitorPip
          key={`${visit.record.handle}:${visit.record.from}`}
          visitor={visit.visitor}
          record={visit.record}
          frame={frame}
          spot={spot}
          door={way}
          hostX={() => live.current.frame.pip?.().x}
          onPhase={report}
          onEvent={onEvent}
          onOpenProfile={onOpenProfile}
        />
      )}
      {note && !visit && <VisitorNote visitor={note.visitor} frame={frame} door={way} onRead={readNote} onOpenProfile={onOpenProfile} />}
    </>
  );
};
