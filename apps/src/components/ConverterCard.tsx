import { useCallback, useEffect, useState } from "react";
import { dependencyFreeSummary, externalConverterCount } from "../constants/bookFormats";
import { CALIBRE_DOWNLOAD_URL } from "../constants/links";
import { getPlatform } from "../platform";
import { accountService } from "../services/accountService";
import { converterService, type ConverterInfo } from "../services/converterService";

const NOT_FOUND: ConverterInfo = { installed: false, path: null, canAutoInstall: false };

/**
 * Settings → Optional book converter (Calibre).
 *
 * Every build gives the reader something to do: "Get Calibre" opens Calibre's
 * own download page in the browser, and "Check Again" looks for it without a
 * restart. Leaflet installing Calibre itself is offered only where the backend
 * says it may (`canAutoInstall`): never in the Microsoft Store build, whose
 * policy does not let an app download and run a program.
 */
export const ConverterCard = ({ showToast }: { showToast: (message: string) => void }) => {
  const [converter, setConverter] = useState<ConverterInfo>(NOT_FOUND);
  const [installing, setInstalling] = useState(false);
  const [checking, setChecking] = useState(false);
  // The converter is compiled out of mobile builds entirely -- there is no
  // Calibre for Android -- so the card must not offer something unreachable.
  const converterSupported = getPlatform() === "desktop";

  const look = useCallback(
    () =>
      converterService
        .status()
        .then((info) => {
          setConverter(info);
          return info;
        })
        .catch(() => {
          setConverter(NOT_FOUND);
          return NOT_FOUND;
        }),
    []
  );

  useEffect(() => {
    void look();
  }, [look]);

  // Installing Calibre happens in another window. Coming back to Leaflet is
  // the moment to look again, so the card is right without anyone asking.
  useEffect(() => {
    if (!converterSupported || converter.installed) {
      return;
    }
    const onFocus = () => void look();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [converterSupported, converter.installed, look]);

  const checkAgain = () => {
    setChecking(true);
    void look()
      .then((info) =>
        showToast(
          info.installed
            ? "Found Calibre. Every supported format can now be opened."
            : "Leaflet can't see Calibre yet. Finish installing it, then check again."
        )
      )
      .finally(() => setChecking(false));
  };

  const getCalibre = () => {
    accountService
      .openLink(CALIBRE_DOWNLOAD_URL)
      .catch(() => showToast("Couldn't open your browser. Calibre is at calibre-ebook.com."));
  };

  const installForMe = () => {
    if (converter.installed || installing || !converter.canAutoInstall) {
      return;
    }
    setInstalling(true);
    converterService
      .install()
      .then(() => converterService.status())
      .then((info) => {
        setConverter(info);
        showToast("Converter ready. Every supported format can now be opened.");
      })
      .catch((error) => {
        if (error instanceof Error && error.message.trim().length > 0) {
          showToast(error.message);
        } else if (typeof error === "string" && error.trim().length > 0) {
          showToast(error);
        } else {
          showToast("Converter install failed. Please retry.");
        }
      })
      .finally(() => setInstalling(false));
  };

  const offerActions = converterSupported && !converter.installed;

  return (
    <div className="paper-surface rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">Optional Book Converter</p>
      <p className="mt-2 text-xs leading-5 text-on-surface-variant">
        <span className="text-on-surface">{dependencyFreeSummary()}</span> open as they are.{" "}
        {converterSupported ? (
          <>
            {externalConverterCount()} other formats, including Kindle and Word files, need Calibre, a free app.
            Once it is installed Leaflet finds it and uses it by itself.
          </>
        ) : (
          <>
            The remaining {externalConverterCount()} formats need Calibre, which has no version for this device.
            Open one on a desktop once and the converted book syncs here like any other.
          </>
        )}
      </p>
      <div className="mt-4 min-w-0">
        <p className="text-sm font-semibold text-on-surface">
          {converter.installed ? "Ready" : converterSupported ? "Not installed" : "Desktop only"}
        </p>
        <p
          className={`text-xs text-on-surface-variant ${converter.installed ? "truncate" : "leading-relaxed"}`}
          title={converter.path ?? undefined}
        >
          {installing
            ? "Downloading and installing…"
            : converter.installed
              ? `Using ${converter.path ?? "the installed converter"}`
              : !converterSupported
                ? "Not available on this device."
                : converter.canAutoInstall
                  ? "Leaflet can install it for you (about 200 MB), or you can get it from calibre-ebook.com."
                  : "Get it from calibre-ebook.com and install it. Leaflet finds it when you come back."}
        </p>
      </div>
      {offerActions && (
        <div className="mt-3 flex flex-wrap gap-3">
          {converter.canAutoInstall && (
            <button
              type="button"
              className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-default disabled:opacity-70"
              onClick={installForMe}
              disabled={installing}
            >
              {installing ? "Installing…" : "Install It for Me"}
            </button>
          )}
          <button
            type="button"
            className={`tactile-button px-4 py-2 text-xs ${converter.canAutoInstall ? "" : "tactile-button-primary"}`}
            onClick={getCalibre}
          >
            Get Calibre
          </button>
          <button
            type="button"
            className="tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            onClick={checkAgain}
            disabled={checking || installing}
          >
            {checking ? "Checking…" : "Check Again"}
          </button>
        </div>
      )}
    </div>
  );
};
