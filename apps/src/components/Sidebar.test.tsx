import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const touch = vi.hoisted(() => ({ value: false }));
vi.mock("../platform/device", () => ({ useTouchInput: () => touch.value }));

import { Sidebar } from "./Sidebar";

const nothing = () => undefined;
const render = () => renderToStaticMarkup(<Sidebar activeItem="Library" onNavigate={nothing} onStartReading={nothing} />);

describe("the rail", () => {
  afterEach(() => {
    touch.value = false;
  });

  it("keeps Settings and Start Reading with a mouse (the desktop, as it was)", () => {
    const markup = render();
    expect(markup).toContain("Settings");
    expect(markup).toContain("Start Reading");
    for (const place of ["Library", "Collections", "Social", "Pip"]) expect(markup).toContain(place);
  });

  it("is the four places only by a finger: Settings is behind the profile button, and there is no Read key", () => {
    touch.value = true;
    const markup = render();
    expect(markup).not.toContain("Settings");
    expect(markup).not.toContain("Start Reading");
    expect(markup).not.toContain(">Read<");
    for (const place of ["Library", "Collections", "Social", "Pip"]) expect(markup).toContain(place);
  });
});
