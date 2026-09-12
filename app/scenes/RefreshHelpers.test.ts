import { describe, expect, it } from "vitest";
import {
  fulfilledRefreshEntries,
  selectChangedRefreshItems,
  settleWithConcurrency,
} from "./RefreshHelpers";

describe("refresh scheduling", () => {
  it("限制同时执行的请求并在单项失败后继续后续任务", async () => {
    let active = 0;
    let peak = 0;
    const results = await settleWithConcurrency([1, 2, 3, 4], 2, async (id) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      if (id === 2) {
        throw new Error("offline");
      }
      return id * 10;
    });

    expect(peak).toBe(2);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(
      results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      )
    ).toEqual([10, 30, 40]);
  });

  it("只把成功的计数请求标记为已刷新", () => {
    const results: PromiseSettledResult<readonly [string, number]>[] = [
      { status: "fulfilled", value: ["paper-a", 7] },
      { status: "rejected", reason: new Error("timeout") },
      { status: "fulfilled", value: ["paper-c", 3] },
    ];

    expect(fulfilledRefreshEntries(results)).toEqual([
      ["paper-a", 7],
      ["paper-c", 3],
    ]);
  });

  it("按更新时间同步到检查点并保留缺少时间的新增条目", () => {
    expect(
      selectChangedRefreshItems(
        [
          { id: "new", updatedAt: "2026-09-12T11:00:00.000Z" },
          { id: "unknown" },
          { id: "checkpoint", updatedAt: "2026-09-12T10:00:00.000Z" },
          { id: "old", updatedAt: "2026-09-12T09:00:00.000Z" },
        ],
        "2026-09-12T10:00:00.000Z"
      )
    ).toEqual({
      changed: [
        { id: "new", updatedAt: "2026-09-12T11:00:00.000Z" },
        { id: "unknown" },
      ],
      reachedCheckpoint: true,
    });
  });

  it("评论增量使用创建时间作为检查点", () => {
    expect(
      selectChangedRefreshItems(
        [
          { id: "later", createdAt: "2026-09-12T12:01:00.000Z" },
          { id: "new", createdAt: "2026-09-12T11:00:00.000Z" },
          { id: "old", createdAt: "2026-09-12T09:00:00.000Z" },
        ],
        "2026-09-12T10:00:00.000Z",
        "2026-09-12T12:00:00.000Z"
      )
    ).toEqual({
      changed: [{ id: "new", createdAt: "2026-09-12T11:00:00.000Z" }],
      reachedCheckpoint: true,
    });
  });
});
