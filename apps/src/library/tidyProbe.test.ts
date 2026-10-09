// @ts-nocheck: Node's own modules, which the app's types leave out; run by hand (see below).
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nameScanned } from "./tidyNames";
import { planTidy } from "./tidyPlan";

/**
 * The middle step of the probe in `src-tauri/src/storage/tidy.rs` (`mod
 * probe`): plans the tidying of a scanned copy of a real folder and writes
 * the moves for the Rust side to make. Numbers only. Skipped unless asked for.
 */
describe.skipIf(!process.env.LEAFLET_TIDY_PROBE)("tidying a real folder, on a copy", () => {
  it("plans every file a place", () => {
    const scratch = join(tmpdir(), "leaflet-tidy-probe");
    const scan = JSON.parse(readFileSync(join(scratch, "scan.json"), "utf8"));
    const plan = planTidy(nameScanned(scan.files, []), join(scratch, "books").length, scan.leftAlone.map((left: { path: string }) => left.path));
    const shapes = { inAuthor: 0, inSeries: 0, numbered: 0, unknownAuthor: 0, numberedTwice: 0 };
    for (const move of plan.moves) {
      const parts = move.to.split("/");
      shapes.inAuthor += parts.length === 2 ? 1 : 0;
      shapes.inSeries += parts.length === 3 ? 1 : 0;
      shapes.numbered += /^\d\d(\.\d+)? - /.test(parts[parts.length - 1]) ? 1 : 0;
      shapes.unknownAuthor += parts[0] === "Unknown author" ? 1 : 0;
      shapes.numberedTwice += / \(\d+\)\.[a-z0-9]+$/.test(move.to) ? 1 : 0;
    }
    console.log(`${scan.files.length} files: ${plan.moves.length} to rename, ${plan.inPlace} in place, ${plan.duplicates.length} duplicates left`, shapes);
    writeFileSync(join(scratch, "moves.json"), JSON.stringify(plan.moves));
    expect(plan.moves.length + plan.inPlace + plan.duplicates.length).toBe(scan.files.length);
  });
});
