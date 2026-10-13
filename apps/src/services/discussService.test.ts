import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import { discussService, type BookCommunity } from "./discussService";

const ID = "0123456789abcdef01234567";
const community = { id: ID, title: "Dune", listed: false } as BookCommunity;

describe("the owner's hand on a community", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ community });
  });

  it("sends only what is being changed, and answers with the community", async () => {
    expect(await discussService.adminCommunity(ID, { relist: false })).toBe(community);
    expect(invoke).toHaveBeenCalledWith("discuss", { route: "admin_community", args: { id: ID, relist: false } });

    await discussService.adminCommunity(ID, { title: "Dune", author: null });
    expect(invoke).toHaveBeenLastCalledWith("discuss", { route: "admin_community", args: { id: ID, title: "Dune", author: null } });
  });

  it("hands on the server's refusal as an error with its words", async () => {
    invoke.mockRejectedValue("keeper: that reader is not a member of this community.");
    await expect(discussService.adminCommunity(ID, { keeper: "maya" })).rejects.toThrow("not a member");
  });
});

describe("a keeper removing a member", () => {
  it("names the community and the reader", async () => {
    invoke.mockReset();
    invoke.mockResolvedValue({ removed: true });
    await discussService.removeMember(ID, "maya");
    expect(invoke).toHaveBeenCalledWith("discuss", { route: "community_remove_member", args: { id: ID, handle: "maya" } });
  });
});
