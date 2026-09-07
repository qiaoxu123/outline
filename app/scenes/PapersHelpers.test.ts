import { describe, expect, test } from "vitest";
import { filterAndSortPapers } from "./PapersHelpers";

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
        },
        b: {
          tags: ["systems"],
          venue: null,
          link: null,
          code: null,
          enTitle: null,
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
        readFilter: "read",
        scope: "all",
        sort: "title",
      },
    }).map((paper) => paper.id);

    expect(result).toEqual(["a"]);
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
        readFilter: "",
        scope: "all",
        sort: "updated",
      },
    }).map((paper) => paper.id);

    expect(result).toEqual(["new", "old"]);
  });
});
