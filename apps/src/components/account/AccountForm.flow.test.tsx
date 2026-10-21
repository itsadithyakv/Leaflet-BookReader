import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../testing/miniDom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
// A build with the community: the sign-up has its handle step.
vi.mock("../../constants/features", () => ({ FEATURES: { accounts: true, community: true, multiDeviceSync: true, fullPipHouse: false, desktopPip: false } }));

// react-dom looks for a document as it loads.
const document = installMiniDom();
(document as unknown as { oninput: null }).oninput = null;

const EMAIL = "ada.reader@example.com";
const CREATED = { available: true, apiBase: "https://api.example.com", signedIn: true, account: { email: EMAIL, emailConfirmed: true }, offline: false };
const SIGNED_OUT = { ...CREATED, signedIn: false, account: null };

describe("the account form, step by step", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root | null;
  let Form: typeof import("./AccountForm").AccountForm;
  let accounts: typeof import("../../store/accountStore").useAccountStore;
  const onDone = vi.fn();

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ AccountForm: Form } = await import("./AccountForm"));
    accounts = (await import("../../store/accountStore")).useAccountStore;
  }, 30_000);

  const settle = async () => {
    for (let round = 0; round < 5; round += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  const mount = async (mode: "signup" | "reset") => {
    accounts.setState({ status: SIGNED_OUT, loaded: true });
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root!.render(<Form initialMode={mode} onDone={onDone} />));
  };
  const unmount = async () => {
    if (root) await React.act(async () => root!.unmount());
    root = null;
  };
  const page = () => document.body as unknown as MiniElement;
  const all = (test: (element: MiniElement) => boolean) => page().findAll(test);
  const find = (test: (element: MiniElement) => boolean) => all(test)[0];
  const button = (label: string) => find((element) => element.tagName === "BUTTON" && element.textContent === label);
  const filled = (element: MiniElement) => element.getAttribute("autoComplete") ?? element.getAttribute("autocomplete");
  const input = (name: string) => find((element) => element.tagName === "INPUT" && (element.getAttribute("name") === name || filled(element) === name));
  const type = async (target: MiniElement | undefined, text: string) => {
    expect(target, "a field to type in").toBeTruthy();
    (target as unknown as { type: string }).type = "text";
    target!.value = text;
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("input", target!));
    });
  };
  const fire = async (target: MiniElement | undefined, kind: "click" | "submit") => {
    expect(target, `something to ${kind}`).toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent(kind, target!));
    });
    await settle();
  };
  const submit = () => fire(find((element) => element.tagName === "FORM"), "submit");
  const heading = () => find((element) => element.tagName === "H2");
  const commands = () => invoke.mock.calls.map(([command]) => command as string);

  beforeEach(() => {
    invoke.mockReset();
    onDone.mockReset();
    document.activeElement = document.body;
  });
  afterEach(unmount);

  const signUp = async () => {
    await mount("signup");
    await type(input("email"), EMAIL);
    await type(input("password"), "a long password");
    await submit();
    expect(commands()).toContain("account_signup");
    expect(heading()?.textContent).toContain("Pick a handle");
  };

  it("puts the focus on the handle step's heading once the account is made (the key pressed has gone)", async () => {
    invoke.mockImplementation(async (command: string) => (command === "account_signup" ? CREATED : null));
    await signUp();
    expect(document.activeElement).toBe(heading());
  });

  it("leaves the profile private on Not now, saving nothing, and says who is signed in", async () => {
    invoke.mockImplementation(async (command: string) => (command === "account_signup" ? CREATED : null));
    await signUp();
    await fire(button("Not now"), "click");
    expect(commands()).not.toContain("save_social_profile");
    expect(onDone).toHaveBeenCalledWith("Account created. Your profile is private.");
    expect(accounts.getState().status.signedIn).toBe(true);
  });

  it("keeps the account when the handle cannot be shared, says why, and hands it over if closed then", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "account_signup") return CREATED;
      if (command === "save_social_profile") throw new Error("That handle is taken.");
      return null;
    });
    await signUp();
    await submit();
    expect(commands()).toContain("save_social_profile");
    expect(page().textContent).toContain("That handle is taken.");
    expect(onDone).not.toHaveBeenCalled();
    // Closed half-way (the dialog's X): the account is real, so the app is told, with the profile private.
    expect(accounts.getState().status.signedIn).toBe(false);
    await unmount();
    expect(accounts.getState().status.signedIn).toBe(true);
  });

  it("says a wrong reset code under the code, not under the new password", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "account_reset_request") return 15;
      if (command === "account_reset_confirm") throw new Error("That code is wrong or has expired. Ask for a new one.");
      return null;
    });
    await mount("reset");
    await type(input("email"), EMAIL);
    await submit();
    // The code's form: its heading has the focus (the key that sent it has gone).
    expect(document.activeElement).toBe(heading());
    await type(input("one-time-code"), "ABCD-EFGH");
    await type(input("new-password"), "a long password");
    await submit();
    const order = all((element) => element.tagName === "INPUT" || element.getAttribute("role") === "alert");
    const error = order.findIndex((element) => element.getAttribute("role") === "alert");
    expect(order[error]?.textContent).toContain("That code is wrong");
    expect(filled(order[error - 1])).toBe("one-time-code");
  });
});
