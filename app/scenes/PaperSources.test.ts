import { describe, expect, test } from "vitest";
import type { CustomDocument } from "./customData";
import { indexPaperSources } from "./PaperSources";

const doc = (id: string, title: string, children: CustomDocument[] = []): CustomDocument => ({
  id,
  title,
  children,
});

describe("indexPaperSources", () => {
  test("includes 推荐阅读, nested 精选专题, 会议论文精选 and 同行成果 once", () => {
    const result = indexPaperSources([
      {
        collection: { id: "learning", name: "扩展学习" },
        tree: [
          doc("rec-root", "推荐阅读", [
            doc("year", "2026 年论文推荐阅读", [
              doc("month", "10 月", [doc("rec", "A paper without emoji")]),
            ]),
          ]),
          doc("featured-root", "精选专题", [
            doc("topic", "具身智能", [
              doc("featured", "📖 Featured", [
                doc("nested", "📖 Nested paper"),
                doc("appendix", "补充材料"),
              ]),
              doc("topic-index", "专题说明"),
            ]),
          ]),
          doc("conference", "会议论文精选", [
            doc("conf", "📖 Conference paper"),
          ]),
          doc("peers", "同行成果", [
            doc("lab", "实验室", [doc("peer", "📖 Peer paper")]),
          ]),
          doc("unrelated", "行业动态", [doc("not-paper", "📖 Not a paper source")]),
        ],
      },
      {
        collection: { id: "work", name: "组内工作" },
        tree: [doc("work", "📖 Internal paper")],
      },
      {
        collection: { id: "personal", name: "Personal" },
        tree: [doc("personal-only", "📖 Personal note")],
      },
    ]);

    expect(result.papers.map((paper) => paper.id)).toEqual([
      "rec", "featured", "nested", "conf", "peer", "work",
    ]);
    expect(result.sourceCollectionIds).toEqual(["learning", "work"]);
    expect(result.papers.find((paper) => paper.id === "featured")?.topic)
      .toBe("精选专题");
    expect(result.papers.find((paper) => paper.id === "rec")).toMatchObject({
      year: 2026,
      month: 10,
    });
  });

  test("supports an independent 精选专题 collection and deduplicates document IDs", () => {
    const result = indexPaperSources([
      {
        collection: { id: "shared", name: "精选专题" },
        tree: [doc("category", "世界模型", [
          doc("same", "📖 Shared paper"),
          doc("index", "专题说明"),
        ])],
      },
      {
        collection: { id: "other", name: "扩展学习" },
        tree: [doc("rec", "推荐阅读", [
          doc("year", "2025 年", [doc("month", "9 月", [
            doc("same", "📖 Shared paper"),
            doc("new", "Non-emoji paper"),
          ])]),
        ])],
      },
    ]);
    expect(result.papers).toHaveLength(2);
    expect(new Set(result.papers.map((p) => p.id)).size).toBe(2);
    expect(result.sourceCollectionIds).toEqual(["shared", "other"]);
  });

  test("does not treat an arbitrary navigation folder as a paper source", () => {
    const result = indexPaperSources([
      { collection: { id: "guide", name: "基础入门" }, tree: [
        doc("nav", "导航", [doc("random", "📖 Read me")]),
      ] },
    ]);
    expect(result).toEqual({ papers: [], sourceCollectionIds: [] });
  });
});
