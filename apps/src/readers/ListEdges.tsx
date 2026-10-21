import { useEffect, useRef, type ReactNode } from "react";
import GradualBlur from "../components/ui/GradualBlur";
import { listEdge } from "./scrollEdges";

/**
 * A list in a reader's panel (the chapters, the notes, a search's hits) with a
 * soft edge where its rows scroll out under the panel's head and foot: they
 * fade into the panel's tint (components/ui/GradualBlur without its blur, see
 * readers/scrollEdges.ts, `listEdge`), only while there is more to scroll
 * that way. The list is the one child that scrolls; this box takes its place
 * in the panel's column.
 */
export const ListEdges = ({ children, className = "" }: { children: ReactNode; className?: string }) => {
  const box = useRef<HTMLDivElement>(null);
  // The edges look again when they are scrolled or the list's box changes size. A list
  // whose box stays put while its rows arrive (a search's hits, found as it reads) would
  // keep its foot's edge hidden until it was first scrolled: its rows coming wake them too.
  useEffect(() => {
    const list = box.current?.firstElementChild;
    if (!list || typeof MutationObserver === "undefined") return undefined;
    let frame = 0;
    const look = () => {
      frame = 0;
      list.dispatchEvent(new Event("scroll"));
    };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(look);
    });
    observer.observe(list, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  const top = listEdge("top");
  const foot = listEdge("bottom");
  return (
    <div ref={box} className={`reader-list-edges ${className}`.trim()}>
      {children}
      <GradualBlur {...top} className="reader-list-edge" />
      <GradualBlur {...foot} className="reader-list-edge" />
    </div>
  );
};
