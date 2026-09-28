import { invoke, isTauri } from "@tauri-apps/api/core";

export type ConverterInfo = {
  installed: boolean;
  /** Where an existing Calibre was found, when one was. */
  path: string | null;
  /** False where Leaflet cannot fetch Calibre for the user (macOS, Linux). */
  canAutoInstall: boolean;
};

const OFFLINE: ConverterInfo = { installed: false, path: null, canAutoInstall: false };

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
  }
};

