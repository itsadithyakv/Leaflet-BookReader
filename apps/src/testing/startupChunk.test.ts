import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * What the app loads before the Library can show: everything `main.tsx`
 * imports, and what those import, short of a dynamic `import()` (React.lazy).
 * That is the first chunk of the build, parsed before the first paint on a
 * phone or a slow laptop. In October 2026 it had grown to 816 KB, most of it
 * the Hollow's art and rules, brought in by the card after a focus session;
 * the card loads on demand now and the chunk is 360 KB. This keeps it so.
 */

// Every source file of the app, by its path under src/ ("pages/LibraryPage.tsx").
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob(["../**/*.{ts,tsx,js}", "!../**/*.test.{ts,tsx}", "!../**/*.d.ts"], {
      query: "?raw",
      import: "default",
      eager: true
    }) as Record<string, string>
  ).map(([file, text]) => [file.replace(/^\.\.\//, ""), text])
);

const endings = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx", "/index.js"];

/** `spec` imported from `from`, as a path under src/, if it is a file of the app. */
const resolve = (from: string, spec: string): string | null => {
  if (!spec.startsWith(".")) {
    return null;
  }
  const parts = from.split("/").slice(0, -1);
  for (const part of spec.split("/")) {
    if (part === "..") {
      parts.pop();
    } else if (part !== ".") {
      parts.push(part);
    }
  }
  const base = parts.join("/");
  return endings.map((ending) => base + ending).find((file) => file in sources) ?? null;
};

/** The modules `entry` brings in at once: files of the app, and packages by name. */
const startupGraph = (entry: string) => {
  const files = new Set<string>([entry]);
  const packages = new Set<string>();
  const queue = [entry];
  for (let file = queue.shift(); file; file = queue.shift()) {
    const source = ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest, false);
    for (const statement of source.statements) {
      let spec: string | null = null;
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
        spec = (statement.moduleSpecifier as ts.StringLiteral).text;
      } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier) {
        spec = (statement.moduleSpecifier as ts.StringLiteral).text;
      }
      if (!spec) {
        continue;
      }
      const target = resolve(file, spec);
      if (target) {
        if (!files.has(target)) {
          files.add(target);
          queue.push(target);
        }
      } else if (!spec.startsWith(".") && !spec.startsWith("@shared/")) {
        // A package (the shared models are types and constants, and import nothing of the app).
        packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
      }
    }
  }
  return { files: [...files], packages };
};

describe("what the app loads at start", () => {
  const { files, packages } = startupGraph("main.tsx");

  it("is found at all", () => {
    expect(files).toContain("App.tsx");
    expect(files).toContain("pages/LibraryPage.tsx");
  });

  it("leaves the readers' libraries to the readers", () => {
    expect(packages.has("epubjs")).toBe(false);
    expect(packages.has("pdfjs-dist")).toBe(false);
  });

  it.each([
    // The Hollow: its art, its rules and its scene.
    "pip/base-art.js",
    "pip/base/rules.ts",
    "components/pip/arcade/base/scene.ts",
    "pip/games-art.js",
    "pip/house.js",
    // The books Pip nods to (fetched when she is first out).
    "pip/books/index.js",
    // The shop's catalogue, the house and the treats (the wardrobe and the profile picture need only pip/moves.js;
    // a focus flower only pip/painter.js).
    "pip/shop.js",
    "pip/home.js",
    "pip/room.js",
    "pip/treats.js",
    // Pip out in the app: she comes once the library is on screen (platform/afterStartup.ts).
    "components/PipWorld.tsx",
    "pip/tour.ts",
    // The Hollow's dot on the Pip tab is worked out after the start too.
    "components/pip/arcade/base/pipTabWaits.ts",
    // Pages and the card after a session.
    "pages/PipPage.tsx",
    "pages/SocialPage.tsx",
    "pages/SettingsPage.tsx",
    "pages/ReaderView.tsx",
    "pages/PageReaderView.tsx",
    "components/SessionWrapUp.tsx"
  ])("does not bring in %s", (file) => {
    expect(files).not.toContain(file);
  });
});
