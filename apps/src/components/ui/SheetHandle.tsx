import { useRef } from "react";

/** How far the sheet is pulled down before letting go closes it. */
const CLOSE_AT = 72;

/**
 * The grip at the top of a dialog drawn as a sheet on a phone
 * (`.sheet-panel`, styles/touch-shell.css): pulled down, the sheet follows
 * the finger, and let go far enough down it closes. Not drawn where the
 * dialog is a centred card. Back and a tap outside close it too; this is
 * the third way, where the thumb already is.
 */
export const SheetHandle = ({ onClose }: { onClose: () => void }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ y: number; at: number; panel: HTMLElement } | null>(null);
  const pulled = useRef(0);

  const settle = (panel: HTMLElement) => {
    panel.style.transition = "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)";
    panel.style.transform = "";
    window.setTimeout(() => {
      panel.style.transition = "";
    }, 220);
  };

  return (
    <div
      ref={ref}
      className="sheet-handle"
      aria-hidden="true"
      onPointerDown={(event) => {
        const panel = ref.current?.closest<HTMLElement>(".sheet-panel");
        if (!panel || event.button > 0) return;
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // A pointer the system no longer knows: the drag still follows its moves over the grip.
        }
        drag.current = { y: event.clientY, at: performance.now(), panel };
        pulled.current = 0;
        panel.style.transition = "none";
      }}
      onPointerMove={(event) => {
        const held = drag.current;
        if (!held) return;
        pulled.current = Math.max(0, event.clientY - held.y);
        held.panel.style.transform = pulled.current > 0 ? `translateY(${pulled.current}px)` : "";
      }}
      onPointerUp={() => {
        const held = drag.current;
        drag.current = null;
        if (!held) return;
        const quick = pulled.current > 24 && pulled.current / Math.max(1, performance.now() - held.at) > 0.6;
        if (pulled.current >= CLOSE_AT || quick) {
          onClose();
          // Still there (it would not close): back up it goes.
          window.requestAnimationFrame(() => held.panel.isConnected && settle(held.panel));
          return;
        }
        settle(held.panel);
      }}
      onPointerCancel={() => {
        const held = drag.current;
        drag.current = null;
        if (held) settle(held.panel);
      }}
    >
      <span />
    </div>
  );
};
