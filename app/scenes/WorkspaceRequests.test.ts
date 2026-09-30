import { describe, expect, it, vi } from "vitest";
import { createSharedRefresh, createWorkspaceReadCache, enqueueWorkspaceWrite } from "./WorkspaceRequests";

describe("workspace refresh lifecycle", () => {
  it("delivers the same pending refresh to a page returning during hydration", async () => {
    const refresh = createSharedRefresh<number>();
    let finish = (_value: number) => {};
    const load = vi.fn(() => new Promise<number>((resolve) => { finish = resolve; }));
    const first = refresh("team-a", load);
    const returnedPage = refresh("team-a", load);
    expect(first).toBe(returnedPage);
    await Promise.resolve();
    finish(42);
    expect(await returnedPage).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("isolates workspaces and releases failed refreshes for retry", async () => {
    const refresh = createSharedRefresh<number>();
    await expect(refresh("a", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(await refresh("a", async () => 1)).toBe(1);
    expect(await refresh("b", async () => 2)).toBe(2);
  });
  it("caches successful reads and lets explicit refresh bypass the TTL", async () => {
    const read = createWorkspaceReadCache<number>(60_000);
    const load = vi.fn(async () => 7);
    expect(await read("a", load)).toBe(7);
    expect(await read("a", load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
    await read("a", load, true);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("serializes likes and ratings and recovers after a failed write", async () => {
    const writes: string[] = [];
    const first = enqueueWorkspaceWrite("interactions", async () => { writes.push("like"); throw new Error("offline"); });
    const second = enqueueWorkspaceWrite("interactions", async () => { writes.push("score"); });
    await expect(first).rejects.toThrow("offline");
    await second;
    expect(writes).toEqual(["like", "score"]);
  });
});
