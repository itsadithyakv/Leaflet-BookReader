import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountForm } from "./AccountForm";
import { SignInPrompt } from "./SignInPrompt";

const nothing = () => undefined;
const form = (mode: "signin" | "signup" | "reset") => renderToStaticMarkup(<AccountForm initialMode={mode} onDone={nothing} />);
/** The words a reader sees: tags, and what is only for screen readers, left out. */
const words = (markup: string) =>
  markup
    .replace(/<label[^>]*class="sr-only"[^>]*>.*?<\/label>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean);

describe("the account form", () => {
  it("puts the switch between signing in and creating an account first, above every field", () => {
    for (const mode of ["signin", "signup"] as const) {
      const markup = form(mode);
      const tablist = markup.indexOf('role="tablist"');
      expect(tablist).toBeGreaterThanOrEqual(0);
      expect(tablist).toBeLessThan(markup.indexOf("<input"));
      expect(markup).toContain(">Sign in</button>");
      expect(markup).toContain(">Create account</button>");
      expect(markup).toMatch(new RegExp(`aria-selected="true"[^>]*>${mode === "signin" ? "Sign in" : "Create account"}<`));
    }
  });

  it("asks only for an email and a password", () => {
    for (const mode of ["signin", "signup"] as const) {
      const markup = form(mode);
      expect(markup.match(/<input/g)).toHaveLength(2);
      expect(markup).not.toMatch(/Name|Handle|Your Pip|Share my profile/);
    }
  });

  it("says no more than it must", () => {
    expect(words(form("signin")).length).toBeLessThanOrEqual(12);
    // The terms line is the only sentence.
    expect(words(form("signup")).length).toBeLessThanOrEqual(20);
    expect(form("signin")).not.toContain("Everything works without one");
  });

  it("lets a phone's password manager fill it, and shows the right keyboard", () => {
    const signIn = form("signin");
    expect(signIn).toContain('type="email"');
    expect(signIn).toContain('inputMode="email"');
    expect(signIn).toContain('autoComplete="username"');
    expect(signIn).toContain('autoComplete="current-password"');
    expect(form("signup")).toContain('autoComplete="new-password"');
  });

  it("keeps Forgot password? by the password when signing in, and a show-password eye", () => {
    const signIn = form("signin");
    expect(signIn.indexOf("Forgot password?")).toBeGreaterThan(signIn.indexOf('name="password"'));
    expect(signIn.indexOf("Forgot password?")).toBeLessThan(signIn.indexOf('type="submit"'));
    expect(signIn).toContain('aria-label="Show password"');
    expect(form("signup")).not.toContain("Forgot password?");
  });

  it("opens on the forgotten password with one field and a way back", () => {
    const reset = form("reset");
    expect(reset).toContain("Reset password");
    expect(reset.match(/<input/g)).toHaveLength(1);
    expect(reset).toContain("Back to sign in");
  });
});

describe("a page's sign-in prompt", () => {
  it("is one line and one button", () => {
    // Pip's sprite reads the display's scale.
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const markup = renderToStaticMarkup(<SignInPrompt line="Sign in to join the board." onSettings={nothing} />);
    expect(markup.match(/<p/g)).toHaveLength(1);
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain("Sign in to join the board.");
    vi.unstubAllGlobals();
  });
});
