/**
 * Why something could not be loaded, with a way to ask again. The same line
 * the profile card shows when the profile could not be read: a failed load
 * is not an empty list, and it is not the end of the page either.
 */
export const ErrorLine = ({ message, onRetry, className = "mt-4" }: { message: string; onRetry?: () => void; className?: string }) => (
  <div role="alert" className={`${className} flex flex-wrap items-center justify-between gap-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface`}>
    <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
    {onRetry && (
      <button type="button" className="tactile-button px-3 py-1 text-xs" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);
