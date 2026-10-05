import { memo } from "react";
import { linkAt, type PageLink } from "./pdfLinks";

type PdfLinkAreasProps = {
  links: ReadonlyArray<PageLink>;
  onFollow: (link: PageLink) => void;
};

/**
 * A PDF page's links (readers/pdfLinks.ts), laid over it as rectangles that
 * are fractions of the page, so they hold at any zoom and finish.
 *
 * They lie under the text layer, not over it: a link laid over the text
 * takes the press that would have begun a selection, and the words of a link
 * could not be selected at all. So the pointer never meets these; a click on
 * the page is matched against them instead (`bindLinkPointer`), and what
 * they are for is the keyboard: each can be reached with Tab, says where it
 * goes, and is followed with Enter.
 */
export const PdfLinkAreas = memo(({ links, onFollow }: PdfLinkAreasProps) => (
  <div className="pdf-reader-links">
    {links.map((link, index) => (
      <button
        key={`${index}-${link.label}`}
        type="button"
        role="link"
        className="pdf-reader-link"
        aria-label={link.label}
        title={link.label}
        style={{
          left: `${link.rect.left * 100}%`,
          top: `${link.rect.top * 100}%`,
          width: `${link.rect.width * 100}%`,
          height: `${link.rect.height * 100}%`
        }}
        onClick={() => onFollow(link)}
      />
    ))}
  </div>
));
PdfLinkAreas.displayName = "PdfLinkAreas";

/** A press that moved further than this before it was let go was a drag, not a click. */
const DRAG_PX = 4;

/**
 * Follows a click on one of a page's links, and shows where the link under
 * the pointer goes (the address, or the page) before it is clicked. `page` is
 * the page's own box (the canvas, the text layer and the link areas fill
 * it); `links` is asked each time, so it may change under the binding.
 *
 * A drag is a selection being made and follows nothing, wherever it began;
 * a click with Ctrl held is a click. Returns the unbinding.
 */
export const bindLinkPointer = (
  page: HTMLElement,
  links: () => ReadonlyArray<PageLink>,
  follow: (link: PageLink) => void
) => {
  const controller = new AbortController();
  const { signal } = controller;
  let pressedAt: { x: number; y: number } | null = null;
  let over: PageLink | null = null;

  const at = (event: MouseEvent) => {
    const all = links();
    if (all.length === 0 || !(page.clientWidth > 0) || !(page.clientHeight > 0)) {
      return null;
    }
    const box = page.getBoundingClientRect();
    return linkAt(
      all,
      (event.clientX - box.left - page.clientLeft) / page.clientWidth,
      (event.clientY - box.top - page.clientTop) / page.clientHeight
    );
  };

  const show = (link: PageLink | null) => {
    if (link === over) {
      return;
    }
    over = link;
    page.classList.toggle("is-over-link", link !== null);
    if (link) {
      page.title = link.label;
    } else {
      page.removeAttribute("title");
    }
  };

  page.addEventListener(
    "mousedown",
    (event) => {
      pressedAt = { x: event.clientX, y: event.clientY };
    },
    { signal }
  );
  // With a button held the pointer is selecting, not looking for a link.
  page.addEventListener("mousemove", (event) => show(event.buttons === 0 ? at(event) : null), { signal });
  page.addEventListener("mouseleave", () => show(null), { signal });
  page.addEventListener(
    "click",
    (event) => {
      const moved = pressedAt ? Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) : 0;
      pressedAt = null;
      if (event.button !== 0 || event.defaultPrevented || moved > DRAG_PX) {
        return;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        return;
      }
      // A link followed from the keyboard is its own button's click.
      if (event.target instanceof Element && event.target.closest("button, a, input")) {
        return;
      }
      const link = at(event);
      if (link) {
        event.preventDefault();
        follow(link);
      }
    },
    { signal }
  );

  return () => {
    controller.abort();
    show(null);
  };
};
