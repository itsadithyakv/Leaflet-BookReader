import { useEffect, type RefObject } from "react";

/** The account forms' fields: a thumb tall, words a size a phone does not zoom for. */
export const fieldClass = "inset-field w-full px-3.5 py-2.5 text-sm text-on-surface";
export const primaryClass =
  "tactile-button tactile-button-primary w-full px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60";
export const linkClass = "py-1 text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60";

/** A short line under the field it is about. */
export const FieldError = ({ id, children }: { id?: string; children: string | null | undefined }) =>
  children ? (
    <p id={id} className="mt-1 text-xs text-error" role="alert">
      {children}
    </p>
  ) : null;

const keyboardUp = () => typeof document !== "undefined" && document.documentElement.dataset.keyboard === "open";

/**
 * With a phone's keyboard up, the field being typed in and the form's button both stay in
 * sight: the button is scrolled into view first and the field after, so where both do not
 * fit, the field wins. (platform/keyboardFocus.ts brings only the field; this form's button
 * was left under the keyboard.)
 */
export const useKeepInView = (form: RefObject<HTMLElement | null>, button: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    let pending = 0;
    const settle = () => {
      if (pending) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        pending = requestAnimationFrame(() => {
          pending = 0;
          // Read now: the form is a different element at each step (sign in, a reset, a code).
          const root = form.current;
          const field = document.activeElement;
          if (!keyboardUp() || !root || !(field instanceof HTMLElement) || !root.contains(field)) return;
          button.current?.scrollIntoView?.({ block: "nearest" });
          field.scrollIntoView?.({ block: "nearest" });
        });
      });
    };
    const watch = new MutationObserver(settle);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-keyboard"] });
    document.addEventListener("focusin", settle);
    window.addEventListener("resize", settle);
    return () => {
      if (pending) cancelAnimationFrame(pending);
      watch.disconnect();
      document.removeEventListener("focusin", settle);
      window.removeEventListener("resize", settle);
    };
  }, [form, button]);
};
