import { AlertCircle } from "lucide-react";
import { COMING_SOON, notThereYet } from "./format";

/**
 * Why something could not be loaded, with a way to ask again. The same line
 * the profile card shows when the profile could not be read: a failed load
 * is not an empty list, and it is not the end of the page either.
 *
 * Quiet, not a red slab (the owner, 2026-10-14: it "makes it look like its
 * an error" when it was nothing of the kind): a muted line with a small mark,
 * and the button to try again. And a part the server has not got yet (the
 * app newer than the server) is no error at all: it says "Coming soon." and
 * offers nothing to try.
 */
export const ErrorLine = ({ message, onRetry, className = "mt-4" }: { message: string; onRetry?: () => void; className?: string }) => {
  if (notThereYet(message)) {
    return (
      <p className={`${className} text-xs text-on-surface-variant`} title="Leaflet's server has not been updated for this yet.">
        {COMING_SOON}
      </p>
    );
  }
  return (
    <div role="alert" className={`${className} flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container-high/50 px-3 py-2 text-xs text-on-surface-variant`}>
      <span className="flex min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
        <AlertCircle size={14} className="shrink-0 text-error/80" aria-hidden />
        {message}
      </span>
      {onRetry && (
        <button type="button" className="tactile-button px-3 py-1 text-xs" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
};
