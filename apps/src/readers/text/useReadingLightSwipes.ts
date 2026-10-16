import { useEffect, useRef } from "react";
import { bindEdgeLight, edgeLightHandlers } from "../edgeLight";
import { CORNER_PX } from "../phoneReading";
import { isPhoneShape } from "../touchLayout";
import type { Box } from "../readingLight";
import type { ReaderScope } from "./scope";

/**
 * The text reader's edges by finger (readers/edgeLight.ts): a swipe up or
 * down from the left strip of the page sets the brightness, from the right
 * the warmth. Bound to each chapter's document (the page is a frame) and to
 * the page around them; on a phone or a tablet only. The bookmark corner and
 * the footer keep their taps.
 */
export const useReadingLightSwipes = (reader: ReaderScope) => {
  const { book, layout, loading, renditionRef, shape, viewerRef } = reader;
  const latest = useRef(reader);
  latest.current = reader;
  const byFinger = shape !== "desktop";
  useEffect(() => {
    const rendition = renditionRef.current;
    if (loading || !rendition || !byFinger) {
      return undefined;
    }
    const pageBox = (): Box | null => {
      const box = viewerRef.current?.parentElement?.getBoundingClientRect();
      return box && box.width > 0 ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
    };
    const selecting = (doc: Document | null) => {
      try {
        const picked = doc?.defaultView?.getSelection?.();
        return Boolean(picked && !picked.isCollapsed && picked.toString().trim());
      } catch {
        return false;
      }
    };
    const light = edgeLightHandlers({
      enabled: () => latest.current.shape !== "desktop" && renditionRef.current === rendition,
      page: pageBox,
      keep: () => {
        const kept: Box[] = [];
        const page = pageBox();
        if (page && isPhoneShape(latest.current.shape)) {
          kept.push({ left: page.left + page.width - CORNER_PX, top: page.top, width: CORNER_PX, height: CORNER_PX });
        }
        const footer = viewerRef.current?.parentElement?.querySelector<HTMLElement>(".reader-phone-footer")?.getBoundingClientRect();
        if (footer && footer.width > 0) {
          kept.push({ left: footer.left, top: footer.top - 4, width: footer.width, height: footer.height + 4 });
        }
        return kept;
      },
      busy: (doc) => latest.current.selectionRef.current !== null || latest.current.interruptedRef.current || selecting(doc)
    });
    const unbind: Array<() => void> = [];
    const bound = new WeakSet<Document>();
    const bind = () => {
      (rendition.getContents?.() ?? []).forEach((contents: any) => {
        const doc = contents?.document as Document | undefined;
        if (!doc || bound.has(doc)) {
          return;
        }
        bound.add(doc);
        unbind.push(bindEdgeLight(doc, light));
      });
    };
    bind();
    rendition.on?.("rendered", bind);
    // Beside the column: the page's own frame, wider than the text.
    const frame = viewerRef.current?.parentElement ?? null;
    if (frame) {
      unbind.push(bindEdgeLight(frame, light));
    }
    return () => {
      rendition.off?.("rendered", bind);
      light.cancel();
      unbind.forEach((off) => off());
    };
  }, [book.id, loading, layout, byFinger]);
};
