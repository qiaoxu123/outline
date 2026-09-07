import { describe, expect, it } from "vitest";
import { visibleTopics, type TopicLike } from "./DiscussHelpers";

const topics: TopicLike[] = [
  { id: "a", title: "视觉模型复现", parentDocumentId: "vision" },
  { id: "b", title: "实验室周报", parentDocumentId: "lab" },
  { id: "c", title: "视觉数据集讨论", parentDocumentId: "vision" },
];

describe("visibleTopics", () => {
  it("filters by category and query", () => {
    expect(
      visibleTopics(topics, {}, { category: "vision", query: "数据集" }).map(
        (topic) => topic.id
      )
    ).toEqual(["c"]);
  });

  it("keeps pinned topics ahead of the regular discussion list", () => {
    expect(
      visibleTopics(topics, { b: "pin-b" }, { category: null, query: "" }).map(
        (topic) => topic.id
      )
    ).toEqual(["b", "a", "c"]);
  });
});
