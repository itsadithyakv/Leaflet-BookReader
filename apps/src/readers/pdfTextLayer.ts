/**
 * Selecting text on a PDF page.
 *
 * The page is a picture; the text that can be selected is pdf.js's text
 * layer, laid transparent over it (pageSources.ts `layText`, styled by
 * pdfTextLayer.css). Every run of text there is its own absolutely placed
 * span, and a browser left to itself selects everything between two spans the
 * moment the pointer passes over the gap between them. pdf.js's viewer keeps
 * the selection steady with an empty block, `endOfContent`, that is stretched
 * under the spans while a selection is being made and kept beside the span
 * the selection ends in. This is that behaviour for the one layer the page
 * reader has.
 */
export const bindTextSelection = (layer: HTMLElement) => {
  const controller = new AbortController();
  const { signal } = controller;
  let pointerDown = false;
  let previous: Range | null = null;

  const endOf = () => layer.querySelector<HTMLElement>(".endOfContent");

  const reset = () => {
    const end = endOf();
    if (end) {
      layer.append(end);
      end.style.width = "";
      end.style.height = "";
    }
    layer.classList.remove("selecting");
  };

  layer.addEventListener("mousedown", () => layer.classList.add("selecting"), { signal });
  document.addEventListener(
    "pointerdown",
    () => {
      pointerDown = true;
    },
    { signal }
  );
  const release = () => {
    pointerDown = false;
    reset();
  };
  document.addEventListener("pointerup", release, { signal });
  window.addEventListener("blur", release, { signal });
  document.addEventListener(
    "keyup",
    () => {
      if (!pointerDown) {
        reset();
      }
    },
    { signal }
  );
  document.addEventListener(
    "selectionchange",
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        reset();
        return;
      }
      const range = selection.getRangeAt(0);
      if (!range.intersectsNode(layer)) {
        reset();
        return;
      }
      layer.classList.add("selecting");
      const end = endOf();
      try {
        // Which end of the selection is moving: the block follows that one.
        const movingStart =
          previous !== null &&
          (range.compareBoundaryPoints(Range.END_TO_END, previous) === 0 ||
            range.compareBoundaryPoints(Range.START_TO_END, previous) === 0);
        let anchor: Node | null = movingStart ? range.startContainer : range.endContainer;
        if (anchor.nodeType === Node.TEXT_NODE) {
          anchor = anchor.parentNode;
        }
        const parent = anchor?.parentElement;
        if (end && anchor && parent && parent.closest(".textLayer") === layer) {
          end.style.width = layer.style.width;
          end.style.height = layer.style.height;
          parent.insertBefore(end, movingStart ? anchor : anchor.nextSibling);
        }
      } catch {
        // The last selection was on a page since turned; there is nothing to compare with.
      }
      previous = range.cloneRange();
    },
    { signal }
  );

  return () => controller.abort();
};
