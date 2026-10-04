import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { boardStamp, cachedBoard, forgetBoards, rememberBoard } from "../src/boardCache.js";

/** The board cache on its own: no database. */

const ROWS = [{ handle: "maya", visibility: "public", weekKey: "2026-W40", weekMinutes: 30 }];

describe("the board cache", () => {
  test("keeps a board for its own week only", () => {
    forgetBoards();
    rememberBoard("2026-W40", ROWS, 3, boardStamp());
    assert.deepEqual(cachedBoard("2026-W40"), { rows: ROWS, sharedReaders: 3 });
    assert.equal(cachedBoard("2026-W41"), null);
    forgetBoards();
    assert.equal(cachedBoard("2026-W40"), null);
  });

  test("does not keep a board read before a profile changed", () => {
    forgetBoards();
    // A request starts reading the board...
    const stamp = boardStamp();
    // ...and while the database is answering, a reader on it goes private.
    forgetBoards();
    // The rows that come back still list them. Kept, they stayed on the
    // public board for the next thirty seconds.
    rememberBoard("2026-W40", ROWS, 3, stamp);
    assert.equal(cachedBoard("2026-W40"), null);

    // A board read after the change is kept as usual.
    rememberBoard("2026-W40", [], 2, boardStamp());
    assert.deepEqual(cachedBoard("2026-W40"), { rows: [], sharedReaders: 2 });
    forgetBoards();
  });
});
