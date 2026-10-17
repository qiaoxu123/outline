import { describe, expect, it } from "vitest";
import {
  aggregateDiscussionComments,
  formatTopicTime,
  isTopicUnread,
  mergeDiscussionCommentDelta,
  mergeDiscussionTopics,
  planDiscussionTopicRefresh,
  selectTopicViewRefreshIds,
  visibleTopics,
  type TopicLike,
} from "./DiscussHelpers";

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

describe("discussion activity helpers", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  it("用简洁的相对时间显示发布时间", () => {
    expect(formatTopicTime("2026-09-07T11:55:00.000Z", now)).toBe("5 分钟前");
    expect(formatTopicTime("2026-09-05T12:00:00.000Z", now)).toBe("2 天前");
  });

  it("只在最后活动晚于已读时间时标记未读", () => {
    expect(
      isTopicUnread("2026-09-07T11:00:00.000Z", "2026-09-07T10:00:00.000Z")
    ).toBe(true);
    expect(
      isTopicUnread("2026-09-07T09:00:00.000Z", "2026-09-07T10:00:00.000Z")
    ).toBe(false);
    expect(isTopicUnread("2026-09-07T11:00:00.000Z", undefined)).toBe(false);
  });

  it("一次聚合整个集合的评论数和最后活动时间", () => {
    expect(
      aggregateDiscussionComments(
        [
          {
            id: "a",
            title: "A",
            updatedAt: "2026-09-07T08:00:00.000Z",
          },
          {
            id: "b",
            title: "B",
            updatedAt: "2026-09-07T07:00:00.000Z",
          },
        ],
        [
          { documentId: "a", createdAt: "2026-09-07T09:00:00.000Z" },
          { documentId: "a", createdAt: "2026-09-07T10:00:00.000Z" },
        ],
        {
          a: {
            replyCount: 7,
            viewCount: 12,
            lastActivity: "2026-09-07T08:30:00.000Z",
          },
        }
      )
    ).toEqual({
      a: {
        replyCount: 2,
        viewCount: 12,
        lastActivity: "2026-09-07T10:00:00.000Z",
      },
      b: {
        replyCount: 0,
        viewCount: 0,
        lastActivity: "2026-09-07T07:00:00.000Z",
      },
    });
  });

  it("增量评论只追加新回复并保留已有计数", () => {
    expect(
      mergeDiscussionCommentDelta(
        [{ id: "a", title: "A", updatedAt: "2026-09-12T08:00:00.000Z" }],
        [
          { documentId: "a", createdAt: "2026-09-12T10:00:00.000Z" },
          { documentId: "a", createdAt: "2026-09-12T11:00:00.000Z" },
        ],
        {
          a: {
            replyCount: 3,
            viewCount: 9,
            lastActivity: "2026-09-12T09:00:00.000Z",
            viewsCheckedAt: 123,
          },
        }
      )
    ).toEqual({
      a: {
        replyCount: 5,
        viewCount: 9,
        lastActivity: "2026-09-12T11:00:00.000Z",
        viewsCheckedAt: 123,
      },
    });
  });

  it("阅读量刷新优先缺失项和最旧项且有单次上限", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    expect(
      selectTopicViewRefreshIds(
        [
          { id: "fresh", title: "Fresh" },
          { id: "missing", title: "Missing" },
          { id: "stale", title: "Stale" },
        ],
        {
          fresh: {
            replyCount: 0,
            viewCount: 1,
            lastActivity: "",
            viewsCheckedAt: now - 1_000,
          },
          stale: {
            replyCount: 0,
            viewCount: 2,
            lastActivity: "",
            viewsCheckedAt: now - 20_000,
          },
        },
        now,
        5_000,
        2
      )
    ).toEqual(["missing", "stale"]);
  });
});

describe("discussion topic refresh", () => {
  it("完整快照只读取同步点后的变化，旧快照执行全量补齐", () => {
    const now = Date.parse("2026-09-12T12:00:00.000Z");
    expect(
      planDiscussionTopicRefresh(
        {
          savedAt: now - 60_000,
          metadataSyncedAt: now - 120_000,
          fullSyncedAt: now - 3_600_000,
          complete: true,
        },
        now,
        24 * 60 * 60 * 1000
      )
    ).toEqual({
      mode: "changed",
      since: new Date(now - 120_000).toISOString(),
    });
    expect(
      planDiscussionTopicRefresh(
        { savedAt: now - 60_000, complete: false },
        now,
        24 * 60 * 60 * 1000
      )
    ).toEqual({ mode: "full" });
  });

  it("定期全量校准主题作者等非文档变更信息", () => {
    const now = Date.parse("2026-09-12T12:00:00.000Z");
    expect(
      planDiscussionTopicRefresh(
        {
          savedAt: now - 60_000,
          metadataSyncedAt: now - 120_000,
          fullSyncedAt: now - 25 * 60 * 60 * 1000,
          complete: true,
        },
        now,
        24 * 60 * 60 * 1000
      )
    ).toEqual({ mode: "full" });
  });

  it("以当前目录为准合并详情并删除已移出讨论区的主题", () => {
    expect(
      mergeDiscussionTopics(
        [
          { id: "kept", title: "目录中的新标题", parentDocumentId: "cat-b" },
          { id: "new", title: "新主题", parentDocumentId: "cat-a" },
        ],
        [
          {
            id: "kept",
            title: "旧标题",
            parentDocumentId: "cat-a",
            createdBy: { id: "u1", name: "乔旭" },
          },
          { id: "removed", title: "已移除" },
        ],
        [
          {
            id: "new",
            title: "新主题",
            parentDocumentId: "cat-a",
            createdBy: { id: "u2", name: "成员" },
          },
        ]
      )
    ).toEqual([
      {
        id: "kept",
        title: "目录中的新标题",
        parentDocumentId: "cat-b",
        createdBy: { id: "u1", name: "乔旭" },
      },
      {
        id: "new",
        title: "新主题",
        parentDocumentId: "cat-a",
        createdBy: { id: "u2", name: "成员" },
      },
    ]);
  });
});

describe("discussion ordering and unread filters", () => {
  const topicsWithActivity: TopicLike[] = [
    { id: "old", title: "Old", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z" },
    { id: "new", title: "New", createdAt: "2026-10-12T10:00:00Z", updatedAt: "2026-10-12T10:00:00Z" },
    { id: "reply", title: "Replied", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z", createdBy: { name: "乔旭" } },
  ];
  const stats = {
    old: { replyCount: 2, viewCount: 10, lastActivity: "2026-10-01T10:00:00Z" },
    new: { replyCount: 0, viewCount: 3, lastActivity: "2026-10-12T10:00:00Z" },
    reply: { replyCount: 17, viewCount: 30, lastActivity: "2026-10-16T10:00:00Z" },
  };

  it("promotes old topics with recent replies above newly created topics", () => {
    expect(
      visibleTopics(topicsWithActivity, {}, { category: null, query: "" }, stats)
        .map((item) => item.id)
    ).toEqual(["reply", "new", "old"]);
  });

  it("supports newest, replies, views and pin priority", () => {
    expect(
      visibleTopics(topicsWithActivity, {}, { category: null, query: "", sort: "newest" }, stats)
        .map((item) => item.id)
    ).toEqual(["new", "old", "reply"]);
    expect(
      visibleTopics(topicsWithActivity, { old: "pin" }, { category: null, query: "", sort: "replies" }, stats)
        .map((item) => item.id)
    ).toEqual(["old", "reply", "new"]);
    expect(
      visibleTopics(topicsWithActivity, {}, { category: null, query: "", sort: "views" }, stats)
        .map((item) => item.id)
    ).toEqual(["reply", "old", "new"]);
  });

  it("marks only post-baseline activity as unread, respecting seen timestamps", () => {
    const firstOpenedAt = "2026-10-10T00:00:00Z";
    expect(
      visibleTopics(topicsWithActivity, {}, {
        category: null, query: "", unreadOnly: true, firstOpenedAt,
        seen: { new: "2026-10-15T00:00:00Z" },
      }, stats).map((item) => item.id)
    ).toEqual(["reply"]);
  });

  it("searches by author name as well as title", () => {
    expect(
      visibleTopics(topicsWithActivity, {}, { category: null, query: "乔旭" }, stats)
        .map((item) => item.id)
    ).toEqual(["reply"]);
  });
});
