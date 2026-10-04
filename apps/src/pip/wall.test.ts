import { describe, expect, it } from "vitest";
import { CLING_SPEED, HALF_W, clingX, meetWall } from "./wall";

const walls = { left: 78, right: 1200, floor: 800 };

describe("a thrown Pip against the walls of the window", () => {
  it("flies on untouched while clear of both walls", () => {
    expect(meetWall(600, 300, 1500, walls)).toEqual({ x: 600, vx: 1500, cling: 0 });
  });

  it("grabs a wall it is thrown hard at, and the grab takes the throw", () => {
    expect(meetWall(1190, 300, 1500, walls)).toEqual({ x: clingX(1, walls), vx: 0, cling: 1 });
    expect(meetWall(90, 300, -1500, walls)).toEqual({ x: clingX(-1, walls), vx: 0, cling: -1 });
  });

  it("drops when it lets go, instead of grabbing the wall again", () => {
    // The hold is inside the wall's reach, so the frame after letting go Pip
    // is still touching it. With the throw's speed left over that was a new
    // grab every time, and one frame of the fall flashed between them.
    for (const side of [-1, 1] as const) {
      const held = meetWall(side < 0 ? 90 : 1190, 300, side * 1500, walls);
      expect(held.cling).toBe(side);
      const after = meetWall(held.x, 300, held.vx, walls);
      expect(after).toEqual({ x: side < 0 ? walls.left + HALF_W : walls.right - HALF_W, vx: 0, cling: 0 });
      // Clear of the wall now, so the frames after that leave it alone.
      expect(meetWall(after.x, 320, after.vx, walls)).toEqual(after);
    }
  });

  it("bounces off when it is too slow to hold on", () => {
    const hit = meetWall(1190, 300, CLING_SPEED, walls);
    expect(hit).toEqual({ x: walls.right - HALF_W, vx: -CLING_SPEED * 0.45, cling: 0 });
    expect(meetWall(90, 300, -400, walls)).toEqual({ x: walls.left + HALF_W, vx: 180, cling: 0 });
  });

  it("bounces off near the floor, where there is no wall left to hold", () => {
    expect(meetWall(1190, 760, 1500, walls).cling).toBe(0);
    expect(meetWall(1190, 739, 1500, walls).cling).toBe(1);
  });

  it("only grabs a wall it is moving into", () => {
    // Let go beyond the right wall and thrown back into the window.
    const back = meetWall(1210, 300, -1500, walls);
    expect(back.cling).toBe(0);
    expect(back.x).toBe(walls.right - HALF_W);
    expect(back.vx).toBeLessThan(0);
  });

  it("ignores the left wall while Pip is still coming out of its home", () => {
    expect(meetWall(40, 300, -1500, walls, false)).toEqual({ x: 40, vx: -1500, cling: 0 });
  });
});
