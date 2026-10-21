import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import { diagnosticsService } from "./diagnosticsService";

const REPORT = "Leaflet 1.5.7\nRecent log:\n...";

describe("reporting a problem", () => {
  const writeText = vi.fn(async (_text: string) => undefined);

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) =>
      command === "diagnostics" ? REPORT : undefined
    );
    writeText.mockClear();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts the report on the clipboard, then opens a letter that carries none of it", async () => {
    expect(await diagnosticsService.reportProblem()).toBe(true);
    expect(writeText).toHaveBeenCalledWith(REPORT);
    expect(invoke).toHaveBeenLastCalledWith("report_problem");
    // Copied before the mail app takes the window.
    const order = invoke.mock.invocationCallOrder;
    expect(writeText.mock.invocationCallOrder[0]).toBeLessThan(order[order.length - 1]);
  });

  it("says when no mail app opened, the report still copied", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "report_problem") throw "Could not open your email app";
      return REPORT;
    });
    expect(await diagnosticsService.reportProblem()).toBe(false);
    expect(writeText).toHaveBeenCalledWith(REPORT);
  });

  it("copies what it is given in place of the report, when sending failed", async () => {
    expect(await diagnosticsService.reportProblem("What happened:\nIt froze.")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("What happened:\nIt froze.");
    expect(invoke).not.toHaveBeenCalledWith("diagnostics");
  });

  it("sends a report to the server, and says why when it could not", async () => {
    const report = { message: "It froze.", diagnostics: REPORT, contact: null };
    await diagnosticsService.sendProblem(report);
    expect(invoke).toHaveBeenLastCalledWith("send_problem", report);
    invoke.mockImplementation(async () => {
      throw "Could not reach the Leaflet server. Check your connection.";
    });
    await expect(diagnosticsService.sendProblem(report)).rejects.toThrow("Could not reach");
  });

  it("opens nothing when nothing could be copied", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    await expect(diagnosticsService.reportProblem()).rejects.toThrow("denied");
    expect(invoke).not.toHaveBeenCalledWith("report_problem");
  });
});
