import { UiIcon, type UiIconName } from "./UiIcon";
import { FEATURES } from "../constants/features";

type WelcomeModalProps = {
  open: boolean;
  /** Whether a Google OAuth client exists, so Drive can be offered at all. */
  driveAvailable: boolean;
  onChooseFolder: () => void;
  onConnectDrive: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
};

type Choice = {
  icon: UiIconName;
  title: string;
  body: string;
  action: string;
  onSelect: () => void;
  primary?: boolean;
};

/**
 * First run. Replaces a sign-in modal that asked for an email, verified nothing,
 * and unlocked nothing — the "account" it created was a `localStorage` object
 * that never reached any server, because there is no server.
 *
 * What is actually worth asking on first run is where reading should be kept, so
 * that is the only question here. Every answer is reversible in Settings.
 */
export const WelcomeModal = ({
  open,
  driveAvailable,
  onChooseFolder,
  onConnectDrive,
  onOpenSettings,
  onDismiss
}: WelcomeModalProps) => {
  if (!open) {
    return null;
  }

  const folderChoice: Choice[] = FEATURES.multiDeviceSync
    ? [
        {
          icon: "sync",
      title: "Use a sync folder",
      body: "Point Leaflet at a folder your Google Drive, Dropbox, OneDrive or iCloud app already keeps in step. Nothing to sign up for.",
          action: "Choose folder",
          onSelect: onChooseFolder
        }
      ]
    : [];

  const choices: Choice[] = [
    driveAvailable
      ? {
          icon: "cloud",
          title: "Back up to Google Drive",
          body: "Sign in with Google and your books, progress and streak are kept safe in your own Drive. Leaflet only ever sees the files it creates there.",
          action: "Connect Drive",
          onSelect: onConnectDrive,
          primary: true
        }
      : {
          icon: "cloud",
          title: "Connect Google Drive",
          body: "This build doesn't include a Google sign-in yet. You can add one in Settings to back up your library.",
          action: "Set up in Settings",
          onSelect: onOpenSettings
        },
    ...folderChoice,
    {
      icon: "book-open",
      title: "Just this device",
      body: "Read offline with nothing else involved. You can turn on backup later without losing anything.",
      action: "Start reading",
      onSelect: onDismiss
    }
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4">
      <div className="modal-surface w-full max-w-lg rounded-2xl p-6">
        <div className="text-center">
          <h2 className="page-title text-2xl text-on-surface">Welcome to Leaflet</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            No account, no subscription. Everything below is free — pick where your reading should
            live.
          </p>
        </div>

        <div className="mt-6 space-y-3">
          {choices.map((choice) => (
            <div key={choice.title} className="paper-surface rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-on-surface-variant">
                  <UiIcon name={choice.icon} size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-on-surface">{choice.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                    {choice.body}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={`tactile-button mt-3 w-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                  choice.primary ? "tactile-button-primary" : ""
                }`}
                onClick={choice.onSelect}
              >
                {choice.action}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-[11px] text-on-surface-variant">
          You can change this any time in Settings.
          {!FEATURES.multiDeviceSync && " The Leaflet mobile app is coming soon."}
        </p>
      </div>
    </div>
  );
};
