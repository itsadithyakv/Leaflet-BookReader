import { invoke, isTauri } from "@tauri-apps/api/core";

export const converterService = {
  async status(): Promise<boolean> {
    if (!isTauri()) {
      return false;
    }
    return invoke<boolean>("converter_status");
  },
  async install(): Promise<boolean> {
    if (!isTauri()) {
      throw new Error("Converter install is only available in the desktop app.");
    }
    return invoke<boolean>("install_converter");
  }
};

