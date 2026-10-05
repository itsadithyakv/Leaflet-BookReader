import { useEffect, type ReactNode } from "react";
import { usePipStore } from "../store/pipStore";
import { canRecall, desktopPip, settingLine, useDesktopPip } from "./sync";

/**
 * Settings → General → "Pip on the desktop". Windows only: elsewhere there is
 * no taskbar for her to walk on, so the row is not shown at all. Off until
 * the reader turns it on.
 *
 * Her own window never takes the keyboard, so this row is also the keyboard's
 * way to everything her menu does: the switch sends her home for good, and
 * "Call Her Back" undoes "Send her home" and "Hide for today".
 */
export const DesktopPipSetting = ({ renderToggle }: { renderToggle: (on: boolean) => ReactNode }) => {
  const status = useDesktopPip();
  const mode = usePipStore((state) => state.mode);

  // Her own menu may have sent her home since this page was last open.
  useEffect(() => {
    void desktopPip.refresh();
  }, []);

  if (!status.supported) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={status.enabled}
        className="inset-field mt-3 flex w-full items-center justify-between gap-3 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
        onClick={() => void desktopPip.setEnabled(!status.enabled)}
      >
        <span className="text-left">
          <span className="block">Pip on the desktop</span>
          <span className="mt-0.5 block text-[11px] opacity-75">{settingLine(status, mode)}</span>
        </span>
        {renderToggle(status.enabled)}
      </button>
      {canRecall(status, mode) && (
        <button type="button" className="tactile-button mt-2 px-4 py-2 text-xs" onClick={() => void desktopPip.recall()}>
          Call Her Back
        </button>
      )}
    </>
  );
};
