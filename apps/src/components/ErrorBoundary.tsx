import { Component, type ErrorInfo, type ReactNode } from "react";
import { diagnosticsService } from "../services/diagnosticsService";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * The last line of defence around the whole app.
 *
 * Without it, one render error anywhere unmounts the tree and leaves a blank
 * window with no way back short of killing the process. Books, progress and
 * the habit ledger all live in the database, so a reload loses nothing but the
 * screen that broke.
 *
 * Deliberately self-contained — plain markup and existing utility classes, no
 * stores or icons — so it still renders when the thing that failed is one of
 * those.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[leaflet] render failed", error, info.componentStack);
    const where = info.componentStack?.trim().split("\n")[0] ?? "";
    diagnosticsService.logError(`screen crashed${where ? ` ${where}` : ""}`, error);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface"
      >
        <div className="paper-surface w-full max-w-md rounded-2xl px-6 py-7 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            Leaflet hit an unexpected problem and could not show this screen. Your books and
            reading progress are saved — reloading will bring you back to your library.
          </p>
          <button
            type="button"
            className="tactile-button mt-5 px-5 py-2 text-xs uppercase tracking-[0.16em]"
            onClick={this.reload}
            autoFocus
          >
            Reload Leaflet
          </button>
          <details className="mt-5 text-left text-xs text-on-surface-variant">
            <summary className="cursor-pointer select-none">Details for a bug report</summary>
            <pre className="selectable mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-container-low p-3">
              {error.name}: {error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
