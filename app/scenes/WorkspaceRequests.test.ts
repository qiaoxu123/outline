import { describe, expect, it, vi } from "vitest";
import { createSharedRefresh, createWorkspaceReadCache, enqueueWorkspaceWrite, updateSharedWebdavJson } from "./WorkspaceRequests";

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

describe("conditional WebDAV JSON updates", () => {
  it("retries conflict and preserves changes made by another device", async () => {
    let version = 1;
    let state = { mine: 0, teammate: 0 };
    let injected = false;
    const bridge = {
      webdavGet: vi.fn(async () => ({
        ok: true,
        data: { found: true, content: JSON.stringify(state), etag: `"${version}"` },
      })),
      webdavPut: vi.fn(async (_path: string, content: string, etag?: string | null) => {
        if (!injected) {
          injected = true;
          state = { ...state, teammate: 8 };
          version += 1;
        }
        if (etag !== `"${version}"`) {
          return { ok: false, error: { code: "CONFLICT", message: "outdated" } };
        }
        state = JSON.parse(content);
        version += 1;
        return { ok: true };
      }),
    };
    const result = await updateSharedWebdavJson(
      bridge, "test.json",
      (content) => JSON.parse(content ?? "{}") as typeof state,
      (current) => ({ ...current, mine: 5 })
    );
    expect(result).toEqual({ mine: 5, teammate: 8 });
    expect(state).toEqual({ mine: 5, teammate: 8 });
    expect(bridge.webdavGet).toHaveBeenCalledTimes(2);
    expect(bridge.webdavPut).toHaveBeenCalledTimes(2);
  });

  it("sends an If-None-Match precondition for first-time shared files", async () => {
    const put = vi.fn(async () => ({ ok: true }));
    await updateSharedWebdavJson(
      {
        webdavGet: async () => ({ ok: true, data: { found: false, etag: null } }),
        webdavPut: put,
      },
      "new.json", (value) => value ? JSON.parse(value) : { likes: 0 },
      (current: { likes: number }) => ({ likes: current.likes + 1 })
    );
    expect(put).toHaveBeenCalledWith(
      "new.json", JSON.stringify({ likes: 1 }, null, 2), null
    );
  });

  it("never writes when a shared file is unreadable or malformed", async () => {
    const write = vi.fn(async () => ({ ok: true }));
    await expect(updateSharedWebdavJson(
      {
        webdavGet: async () => ({ ok: true, data: { found: true, content: "invalid json", etag: '"1"' } }),
        webdavPut: write,
      },
      "corrupt.json", (content) => JSON.parse(content ?? "{}"),
      (current) => current
    )).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it("stops after bounded conflicts without silently overwriting remote data", async () => {
    const write = vi.fn(async () => ({ ok: false, error: { code: "CONFLICT" } }));
    await expect(updateSharedWebdavJson(
      {
        webdavGet: async () => ({ ok: true, data: { found: true, content: "{}", etag: '"1"' } }),
        webdavPut: write,
      },
      "busy.json", (raw) => JSON.parse(raw ?? "{}"), (data) => ({ ...data, myLike: true })
    )).rejects.toThrow();
    expect(write).toHaveBeenCalledTimes(3);
  });
});
