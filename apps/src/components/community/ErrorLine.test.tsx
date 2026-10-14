import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorLine } from "./ErrorLine";

const nothing = () => undefined;

describe("the line a failed load leaves", () => {
  it("says a part the server has not got yet is coming soon, quietly, with nothing to try again", () => {
    for (const message of ["Not found.", "Coming soon."]) {
      const markup = renderToStaticMarkup(<ErrorLine message={message} onRetry={nothing} />);
      expect(markup).toContain("Coming soon.");
      expect(markup).not.toContain("Try again");
      expect(markup).not.toContain('role="alert"');
      expect(markup).not.toContain("Not found");
    }
  });

  it("says anything else as it came, with Try again, and is not a red slab", () => {
    const markup = renderToStaticMarkup(<ErrorLine message="The server took too long." onRetry={nothing} />);
    expect(markup).toContain("The server took too long.");
    expect(markup).toContain("Try again");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("bg-error-container");
  });
});
