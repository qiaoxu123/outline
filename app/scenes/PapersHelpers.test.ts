import { describe, expect, test } from "vitest";
import {
  filterAndSortPapers,
  planPaperMetadataRefresh,
  planPaperMetadataHydration,
  parsePaperData,
  parsePaperMeta,
  selectChangedPaperDocuments,
  selectPaperViewRefreshIds,
  summarizePaperTags,
  sumViewCounts,
} from "./PapersHelpers";

describe("parsePaperMeta", () => {
  test("从论文元数据表中恢复原始标题、作者、机构与标签", () => {
    const meta = parsePaperMeta(`
| 字段 | 内容 |
| --- | --- |
| 论文标题 | AerialVG: A Challenging Benchmark for Aerial Visual Grounding by Exploring Positional Relations |
| 论文作者 | Junli Liu, Qizhi Chen, Yifan Zhang |
| 作者单位 | Wuhan University; Peking University |
| 期刊会议 | ICCV 2025 |
| 主题标签 | 航拍视觉定位、UAV 感知、空间关系推理 |
| 论文链接 | [Paper](https://arxiv.org/abs/2503.12345) |
| 代码仓库 | https://github.com/example/AerialVG |
`);

    expect(meta).toMatchObject({
      enTitle:
        "AerialVG: A Challenging Benchmark for Aerial Visual Grounding by Exploring Positional Relations",
      authors: "Junli Liu, Qizhi Chen, Yifan Zhang",
      org: "Wuhan University; Peking University",
      venue: "ICCV 2025",
      tags: ["航拍视觉定位", "UAV 感知", "空间关系推理"],
      link: "https://arxiv.org/abs/2503.12345",
      code: "https://github.com/example/AerialVG",
      parsed: true,
    });
  });

  test("忽略占位符并支持常见别名", () => {
    const meta = parsePaperMeta(`
English title: **Useful Original Title**
Authors: -
Tags: vision, multimodal
Venue: N/A
`);

    expect(meta.enTitle).toBe("Useful Original Title");
    expect(meta.authors).toBeNull();
    expect(meta.venue).toBeNull();
    expect(meta.tags).toEqual(["vision", "multimodal"]);
  });
});

describe("parsePaperData", () => {
  test("支持 Outline API v3 documents.list 的 ProseMirror data", () => {
    const cell = (text: string) => ({
      type: "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const row = (name: string, value: string) => ({
      type: "tableRow",
      content: [cell(name), cell(value)],
    });

    const meta = parsePaperData({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            row("论文标题", "AerialVG: A Challenging Benchmark"),
            row("论文作者", "Junli Liu, Qizhi Chen"),
            row("主题标签", "航拍视觉定位、空间关系推理"),
          ],
        },
      ],
    });

    expect(meta.enTitle).toBe("AerialVG: A Challenging Benchmark");
    expect(meta.authors).toBe("Junli Liu, Qizhi Chen");
    expect(meta.tags).toEqual(["航拍视觉定位", "空间关系推理"]);
  });
});

describe("sumViewCounts", () => {
  test("汇总 Outline views.list 返回的多条阅读记录", () => {
    expect(sumViewCounts([{ count: 3 }, { count: 2 }, {}])).toBe(5);
  });
});

describe("paper refresh planning", () => {
  test("已完成的元数据快照只增量请求后续变更", () => {
    expect(
      planPaperMetadataRefresh({
        savedAt: Date.parse("2026-09-07T08:00:00.000Z"),
        metadataSyncedAt: Date.parse("2026-09-07T09:00:00.000Z"),
        complete: true,
      })
    ).toEqual({
      mode: "changed",
      since: "2026-09-07T09:00:00.000Z",
    });
  });

  test("未完成的冷启动快照仍执行一次全量补齐", () => {
    expect(
      planPaperMetadataRefresh({
        savedAt: Date.parse("2026-09-07T08:00:00.000Z"),
        complete: false,
      })
    ).toEqual({ mode: "full" });
  });

  test("少量新入库论文只做增量扫描并定点补元数据", () => {
    const meta = {
      tags: [], venue: null, link: null, code: null, enTitle: null,
      authors: null, org: null, parsed: true,
    };
    const snapshot = {
      savedAt: Date.parse("2026-10-16T09:00:00Z"),
      metadataSyncedAt: Date.parse("2026-10-16T10:00:00Z"),
      complete: true,
      metas: { existing: meta },
    };
    expect(planPaperMetadataHydration(snapshot, [
      { id: "existing" }, { id: "moved-old" }, { id: "new" },
    ])).toEqual({
      mode: "changed",
      since: "2026-10-16T10:00:00.000Z",
    });
  });

  test("大批新论文仍使用全量扫描，避免大量逐篇请求", () => {
    const snapshot = {
      savedAt: Date.parse("2026-10-16T10:00:00Z"),
      complete: true,
      metas: {},
    };
    const papers = Array.from({ length: 25 }, (_, i) => ({ id: String(i) }));
    expect(planPaperMetadataHydration(snapshot, papers)).toEqual({ mode: "full" });
  });

  test("阅读量只选未缓存或已过期的论文并限制单次数量", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const papers = [
      { id: "fresh", title: "Fresh" },
      { id: "missing", title: "Missing" },
      { id: "oldest", title: "Oldest" },
      { id: "older", title: "Older" },
    ];

    expect(
      selectPaperViewRefreshIds(
        papers,
        {
          fresh: now - 1_000,
          oldest: now - 20_000,
          older: now - 10_000,
        },
        now,
        5_000,
        2
      )
    ).toEqual(["missing", "oldest"]);
  });

  test("旧服务器上由客户端只提取同步点之后的文档", () => {
    expect(
      selectChangedPaperDocuments(
        [
          { id: "new", updatedAt: "2026-09-07T10:00:00.000Z" },
          { id: "same", updatedAt: "2026-09-07T09:00:00.000Z" },
          { id: "old", updatedAt: "2026-09-07T08:00:00.000Z" },
        ],
        "2026-09-07T09:00:00.000Z"
      )
    ).toEqual({
      changed: [{ id: "new", updatedAt: "2026-09-07T10:00:00.000Z" }],
      reachedCheckpoint: true,
    });
  });
});

describe("filterAndSortPapers", () => {
  test("filters by query, tag, and reading state before sorting", () => {
    const result = filterAndSortPapers({
      papers: [
        { id: "a", title: "Paper A", updatedAt: "2026-09-01" },
        { id: "b", title: "Paper B", updatedAt: "2026-09-02" },
      ],
      metas: {
        a: {
          tags: ["vision"],
          venue: null,
          link: null,
          code: null,
          enTitle: null,
          authors: "Grace Hopper",
          org: "US Navy",
          parsed: true,
        },
        b: {
          tags: ["systems"],
          venue: null,
          link: null,
          code: null,
          enTitle: null,
          authors: null,
          org: null,
          parsed: true,
        },
      },
      read: { a: "read", b: "unread" },
      likes: {},
      viewed: {},
      viewCounts: {},
      ratings: {},
      options: {
        query: "paper",
        tag: "vision",
        year: null,
        month: null,
        readFilter: "read",
        scope: "all",
        sort: "title",
      },
    }).map((paper) => paper.id);

    expect(result).toEqual(["a"]);
  });

  test("可以按原始标题、作者和机构检索", () => {
    const makeOptions = (query: string) => ({
      query,
      tag: null,
      year: null,
      month: null,
      readFilter: "" as const,
      scope: "all" as const,
      sort: "updated" as const,
    });
    const input = {
      papers: [{ id: "a", title: "航拍视觉定位", updatedAt: "2026-09-01" }],
      metas: {
        a: {
          tags: ["vision"],
          venue: "ICCV 2025",
          link: null,
          code: null,
          enTitle: "Aerial Visual Grounding",
          authors: "Junli Liu",
          org: "Wuhan University",
          parsed: true,
        },
      },
      read: {},
      likes: {},
      viewed: {},
      viewCounts: {},
      ratings: {},
    };

    for (const query of ["aerial visual", "junli", "wuhan university"]) {
      expect(
        filterAndSortPapers({ ...input, options: makeOptions(query) })
      ).toHaveLength(1);
    }
  });

  test("keeps the newest updated paper first by default", () => {
    const result = filterAndSortPapers({
      papers: [
        { id: "old", title: "Old", updatedAt: "2026-09-01" },
        { id: "new", title: "New", updatedAt: "2026-09-03" },
      ],
      metas: {},
      read: {},
      likes: {},
      viewed: {},
      viewCounts: {},
      ratings: {},
      options: {
        query: "",
        tag: null,
        year: null,
        month: null,
        readFilter: "",
        scope: "all",
        sort: "updated",
      },
    }).map((paper) => paper.id);

    expect(result).toEqual(["new", "old"]);
  });

  test("按推荐年份和月份组合筛选论文", () => {
    const result = filterAndSortPapers({
      papers: [
        { id: "aug", title: "August", year: 2026, month: 8 },
        { id: "sep", title: "September", year: 2026, month: 9 },
        { id: "old", title: "Previous year", year: 2025, month: 8 },
      ],
      metas: {},
      read: {},
      likes: {},
      viewed: {},
      viewCounts: {},
      ratings: {},
      options: {
        query: "",
        tag: null,
        year: 2026,
        month: 8,
        readFilter: "",
        scope: "all",
        sort: "title",
      },
    }).map((paper) => paper.id);

    expect(result).toEqual(["aug"]);
  });
});

describe("summarizePaperTags", () => {
  test("限制论文行标签数量并报告剩余数量", () => {
    expect(
      summarizePaperTags(["VLA", "VLN", "具身智能", "机器人", "世界模型"], 4)
    ).toEqual({
      visible: ["VLA", "VLN", "具身智能", "机器人"],
      hiddenCount: 1,
    });
  });
});


describe("paper state transitions", () => {
  it("advances an implicit unread state on the first click", async () => {
    const { nextPaperReadState } = await import("./PapersHelpers");
    expect(nextPaperReadState()).toBe("reading");
    expect(nextPaperReadState("reading")).toBe("read");
    expect(nextPaperReadState("read")).toBe("unread");
  });
  it("retains other users' ratings when updating or clearing my score", async () => {
    const { optimisticPaperRating } = await import("./PapersHelpers");
    // Two ratings: mine=2, another user's=4.
    const updated = optimisticPaperRating({ average: 3, count: 2, mine: 2 }, 5);
    expect(updated).toEqual({ average: 4.5, count: 2, mine: 5 });
    expect(optimisticPaperRating(updated, null)).toEqual({ average: 4, count: 1, mine: null });
  });
});

describe("paper popularity and filtered counts", () => {
  const options = {
    query: "",
    tag: null,
    year: null,
    month: null,
    readFilter: "" as const,
    scope: "all" as const,
    sort: "likes" as const,
  };

  it("ranks team-wide likes rather than only my likes", () => {
    const papers = [
      { id: "mine", title: "Mine", updatedAt: "2026-10-13" },
      { id: "popular", title: "Popular", updatedAt: "2026-10-12" },
      { id: "newest", title: "Newest", updatedAt: "2026-10-14" },
    ];
    expect(
      filterAndSortPapers({
        papers, metas: {}, read: {}, likes: { mine: "1" },
        likeCounts: { mine: 1, popular: 12, newest: 1 },
        viewed: {}, viewCounts: {}, ratings: {}, options,
      }).map((paper) => paper.id)
    ).toEqual(["popular", "newest", "mine"]);
  });

  it("preserves the personal liked-only filter without changing popularity order", () => {
    expect(
      filterAndSortPapers({
        papers: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
        metas: {}, read: {}, likes: { a: "1" },
        likeCounts: { a: 1, b: 100 },
        viewed: {}, viewCounts: {}, ratings: {},
        options: { ...options, scope: "liked" },
      }).map((paper) => paper.id)
    ).toEqual(["a"]);
  });
});
