import { invoke, isTauri } from "@tauri-apps/api/core";
import { CALIBRE_DOWNLOAD_URL } from "../constants/links";

export type ConverterInfo = {
  installed: boolean;
  /** Where an existing Calibre was found, when one was. */
  path: string | null;
  /** False where Leaflet cannot fetch Calibre for the user (macOS, Linux). */
  canAutoInstall: boolean;
};

const OFFLINE: ConverterInfo = { installed: false, path: null, canAutoInstall: false };

/**
 * What a reader without Calibre can be offered: Leaflet installing it
 * ("install"), a link to get it themselves ("get"), or nothing, on a device
 * Calibre has no version for. Anywhere the backend does not say it may install
 * (the Microsoft Store build, or a status that could not be read) the answer
 * is never "install".
 */
export type ConverterOffer = "install" | "get" | "none";

export const converterOffer = (
  desktop: boolean,
  info: Pick<ConverterInfo, "canAutoInstall"> | null
): ConverterOffer => (!desktop ? "none" : info?.canAutoInstall === true ? "install" : "get");

export const converterService = {
  async status(): Promise<ConverterInfo> {
    if (!isTauri()) {
      return OFFLINE;
    }
    return invoke<ConverterInfo>("converter_status");
  },
  async install(): Promise<boolean> {
    if (!isTauri()) {
      throw new Error("Converter install is only available in the desktop app.");
    }
    return invoke<boolean>("install_converter");
  },
  /** Opens Calibre's own download page in the reader's browser. */
  async openDownloadPage(): Promise<void> {
    if (!isTauri()) {
      window.open(CALIBRE_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
      return;
    }
    await invoke("open_public_link", { url: CALIBRE_DOWNLOAD_URL });
  }
};

