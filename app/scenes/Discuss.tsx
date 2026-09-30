import { observer } from "mobx-react";
import { CommentIcon, EyeIcon, PinIcon, ThumbsUpIcon } from "outline-icons";
import * as React from "react";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import ButtonSmall from "~/components/ButtonSmall";
import Empty from "~/components/Empty";
import InputSearch from "~/components/InputSearch";
import Scene from "~/components/Scene";
import Tooltip from "~/components/Tooltip";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import { openInTab } from "~/utils/tabNavigation";
import {
  collectionDocuments,
  flattenDocuments,
  listCollections,
  type CustomDocument,
} from "./customData";
import {
  aggregateDiscussionComments,
  formatTopicTime,
  isTopicUnread,
  mergeDiscussionCommentDelta,
  mergeDiscussionTopics,
  planDiscussionTopicRefresh,
  selectTopicViewRefreshIds,
  visibleTopics,
  type DiscussionComment,
  type DiscussionTopicStats,
} from "./DiscussHelpers";
import {
  fulfilledRefreshEntries,
  selectChangedRefreshItems,
} from "./RefreshHelpers";

import { createSharedRefresh, createWorkspaceReadCache, enqueueWorkspaceWrite } from "./WorkspaceRequests";
import { WorkspacePagination, useWorkspacePage } from "./WorkspaceList";

type Topic = Omit<CustomDocument, "createdBy"> & {
  parentDocumentId?: string | null;
  createdBy?: {
    id: string;
    name?: string;
    avatarUrl?: string | null;
  };
};
type TopicStats = DiscussionTopicStats;
type LikeEntry = { name: string; at: string };
type LikeData = {
  version: 1;
  topics: Record<string, Record<string, LikeEntry>>;
};
type WebdavResult = {
  ok?: boolean;
  data?: { found?: boolean; content?: string };
};
type StatsCache = {
  savedAt: number;
  commentsSavedAt?: number;
  commentsFullSyncedAt?: number;
  stats: Record<string, TopicStats>;
};
type TopicSnapshot = {
  savedAt: number;
  metadataSyncedAt?: number;
  fullSyncedAt?: number;
  complete?: boolean;
  topics: Topic[];
  categories: CustomDocument[];
  forumCollectionId: string | null;
  forumFound: boolean;
};

const refreshTopics = createSharedRefresh<TopicSnapshot>();
const readPins = createWorkspaceReadCache<Record<string, string>>(60_000);

const likesPath = "讨论区/likes.json";
const likeCacheKey = "outline.desktop.discuss.likes.v2";
const statsCacheKey = "outline.desktop.discuss.stats.v1";
const topicCacheKey = "outline.desktop.discuss.topics.v1";
const seenKey = "outline.desktop.discuss.seen.v1";
const TOPIC_CACHE_TTL = 5 * 60 * 1000;
const TOPIC_FULL_REFRESH_TTL = 24 * 60 * 60 * 1000;
const COMMENT_CACHE_TTL = 5 * 60 * 1000;
const COMMENT_FULL_REFRESH_TTL = 24 * 60 * 60 * 1000;
const VIEW_CACHE_TTL = 30 * 60 * 1000;
const VIEW_REFRESH_LIMIT = 24;
const VIEW_REFRESH_CONCURRENCY = 4;
const emptyLikes: LikeData = { version: 1, topics: {} };

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage pressure disables persistence, never the live discussion board.
  }
}

function asWebdavResult(value: unknown): WebdavResult {
  return value && typeof value === "object" ? (value as WebdavResult) : {};
}

function parseLikes(content: string | undefined): LikeData {
  if (!content) {
    return emptyLikes;
  }
  try {
    const parsed = JSON.parse(content) as LikeData;
    return parsed && typeof parsed.topics === "object" ? parsed : emptyLikes;
  } catch {
    return emptyLikes;
  }
}

function categoryMap(categories: CustomDocument[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const category of categories) {
    const pending = [...(category.children ?? [])];
    while (pending.length) {
      const item = pending.shift()!;
      result.set(item.id, category.id);
      pending.unshift(...(item.children ?? []));
    }
  }
  return result;
}

function DiscussWorkspace() {
  const { documents, tabs, auth } = useStores();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const history = useHistory();
  const scope = auth.currentTeamId ?? window.location.host;
  const initialSnapshot = React.useMemo(
    () => readJson<TopicSnapshot | null>(`${topicCacheKey}.${scope}`, null),
    [scope]
  );
  const [topics, setTopics] = React.useState<Topic[]>(
    () => initialSnapshot?.topics ?? []
  );
  const [categories, setCategories] = React.useState<CustomDocument[]>(
    () => initialSnapshot?.categories ?? []
  );
  const [forumCollectionId, setForumCollectionId] = React.useState<
    string | null
  >(() => initialSnapshot?.forumCollectionId ?? null);
  const [forumFound, setForumFound] = React.useState(
    () => initialSnapshot?.forumFound ?? true
  );
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(() => !initialSnapshot);
  const [refreshing, setRefreshing] = React.useState(false);
  const [statsRefresh, setStatsRefresh] = React.useState(0);
  const [pinPending, setPinPending] = React.useState<Record<string, boolean>>({});
  const [composing, setComposing] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("");
  const [likeData, setLikeData] = React.useState<LikeData>(() =>
    readJson(`${likeCacheKey}.${scope}`, emptyLikes)
  );
  const [stats, setStats] = React.useState<Record<string, TopicStats>>(
    () =>
      readJson<StatsCache>(`${statsCacheKey}.${scope}`, {
        savedAt: 0,
        stats: {},
      }).stats
  );
  const [seen, setSeen] = React.useState<Record<string, string>>(() =>
    readJson(`${seenKey}.${scope}`, {})
  );
  const [pins, setPins] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const requestId = React.useRef(0);

  const load = React.useCallback(
    async (force = false) => {
      const generation = ++requestId.current;
      if (force) { setStatsRefresh((value) => value + 1); }
      const cached = readJson<TopicSnapshot | null>(
        `${topicCacheKey}.${scope}`,
        null
      );
      if (cached) {
        setTopics(cached.topics);
        setCategories(cached.categories);
        setForumCollectionId(cached.forumCollectionId);
        setForumFound(cached.forumFound);
        setLoading(false);
        if (!force && Date.now() - cached.savedAt < TOPIC_CACHE_TTL) {
          return;
        }
      } else {
        setLoading(true);
      }
      setRefreshing(true);
      setError(null);
      try {
        const snapshot = await refreshTopics(scope, async () => {
        const assertWorkspace = () => {
          if ((auth.currentTeamId ?? window.location.host) !== scope) {
            throw new Error("工作区已切换，取消旧索引任务。");
          }
        };
        assertWorkspace();
        const collections = await listCollections(scope, force);
        const forum = collections.find((item) =>
          ["论坛空间", "讨论区"].includes(item.name.trim())
        );
        if (!forum) {
          const empty: TopicSnapshot = {
            savedAt: Date.now(), topics: [], categories: [],
            forumCollectionId: null, forumFound: false, complete: true,
          };
          writeJson(`${topicCacheKey}.${scope}`, empty);
          return empty;
        }
        assertWorkspace();
        const tree = await collectionDocuments(forum.id, scope, force);
        const cats = tree.filter((item) => (item.children?.length ?? 0) > 0);
        const categoryIds = new Set(cats.map((item) => item.id));
        const categoryOf = categoryMap(cats);
        const indexedTopics = flattenDocuments(tree)
          .filter((item) => !categoryIds.has(item.id))
          .map(
            (item) =>
              ({
                ...item,
                children: undefined,
                parentDocumentId:
                  categoryOf.get(item.id) ?? item.parentDocumentId ?? null,
              }) as Topic
          );
        if (!cached && requestId.current === generation) {
          setForumFound(true);
          setForumCollectionId(forum.id);
          setCategories(cats);
          setTopics(indexedTopics);
          setLoading(false);
        }
        const syncStartedAt = Date.now();
        const refreshPlan = planDiscussionTopicRefresh(
          cached,
          syncStartedAt,
          TOPIC_FULL_REFRESH_TTL
        );
        const pageSize = refreshPlan.mode === "changed" ? 20 : 100;
        const listed: Topic[] = [];
        for (let offset = 0; offset < 10000; offset += pageSize) {
          assertWorkspace();
          const response = await client.post<{
            data: Topic[];
            pagination?: { total?: number };
          }>("/documents.list", {
            collectionId: forum.id,
            sort: "updatedAt",
            direction: "DESC",
            limit: pageSize,
            offset,
          });
          const page = response.data ?? [];
          const selected =
            refreshPlan.mode === "changed"
              ? selectChangedRefreshItems(page, refreshPlan.since)
              : { changed: page, reachedCheckpoint: false };
          listed.push(...selected.changed);
          if (
            selected.reachedCheckpoint ||
            page.length < pageSize ||
            (response.pagination?.total !== undefined &&
              offset + page.length >= response.pagination.total)
          ) {
            break;
          }
        }
        const refreshedTopics = listed
          .filter((item) => !categoryIds.has(item.id))
          .map((item) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            urlId: item.urlId,
            collectionId: item.collectionId,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            createdBy: item.createdBy,
            parentDocumentId:
              categoryOf.get(item.id) ?? item.parentDocumentId ?? null,
          }));
        const nextTopics = mergeDiscussionTopics(
          indexedTopics,
          cached?.topics ?? [],
          refreshedTopics
        ).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
        const snapshot: TopicSnapshot = {
          savedAt: Date.now(),
          metadataSyncedAt: syncStartedAt,
          fullSyncedAt:
            refreshPlan.mode === "full" ? syncStartedAt : cached?.fullSyncedAt,
          complete:
            refreshPlan.mode === "full" ? true : Boolean(cached?.complete),
          topics: nextTopics,
          categories: cats,
          forumCollectionId: forum.id,
          forumFound: true,
        };
        assertWorkspace();
        writeJson(`${topicCacheKey}.${scope}`, snapshot);
        return snapshot;
        });
        if (requestId.current === generation) {
          setForumFound(snapshot.forumFound);
          setForumCollectionId(snapshot.forumCollectionId);
          setCategories(snapshot.categories);
          setTopics(snapshot.topics);
        }
      } catch (cause) {
        if (requestId.current === generation) {
          setError(cause instanceof Error ? cause.message : "加载失败");
        }
      } finally {
        if (requestId.current === generation) {
          setRefreshing(false);
          setLoading(false);
        }
      }
    },
    [scope]
  );

  React.useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  React.useEffect(() => {
    let cancelled = false;
    setLikeData(readJson(`${likeCacheKey}.${scope}`, emptyLikes));
    setSeen(readJson(`${seenKey}.${scope}`, {}));
    void window.DesktopBridge?.webdavGet(likesPath)
      .then((value) => {
        const result = asWebdavResult(value);
        if (cancelled || !result.ok || !result.data?.found) {
          return;
        }
        const remote = parseLikes(result.data.content);
        setLikeData(remote);
        writeJson(`${likeCacheKey}.${scope}`, remote);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope]);

  React.useEffect(() => {
    if (!topics.length || !forumCollectionId) {
      return;
    }
    const cache = readJson<StatsCache>(`${statsCacheKey}.${scope}`, {
      savedAt: 0,
      stats: {},
    });
    setStats(cache.stats);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        let next = { ...cache.stats };
        for (const topic of topics) {
          next[topic.id] ??= {
            replyCount: 0,
            viewCount: 0,
            lastActivity: topic.updatedAt ?? topic.createdAt ?? "",
          };
        }
        let commentsSavedAt = cache.commentsSavedAt ?? cache.savedAt;
        let commentsFullSyncedAt = cache.commentsFullSyncedAt;
        const now = Date.now();
        const needsComments =
          statsRefresh > 0 || topics.some((topic) => !cache.stats[topic.id]) ||
          now - commentsSavedAt >= COMMENT_CACHE_TTL;
        if (needsComments) {
          try {
            const commentsSyncStartedAt = Date.now();
            const commentRefreshPlan = planDiscussionTopicRefresh(
              {
                savedAt: commentsSavedAt,
                metadataSyncedAt: commentsSavedAt,
                fullSyncedAt: commentsFullSyncedAt,
                complete: true,
              },
              commentsSyncStartedAt,
              COMMENT_FULL_REFRESH_TTL
            );
            const pageSize = commentRefreshPlan.mode === "changed" ? 20 : 100;
            const comments: DiscussionComment[] = [];
            for (let offset = 0; offset < 10000; offset += pageSize) {
              if (cancelled) { return; }
              const response = await client.post<{
                data: DiscussionComment[];
                pagination?: { total?: number };
              }>("/comments.list", {
                collectionId: forumCollectionId,
                sort: "createdAt",
                direction: "DESC",
                limit: pageSize,
                offset,
              });
              const page = response.data ?? [];
              const selected =
                commentRefreshPlan.mode === "changed"
                  ? selectChangedRefreshItems(
                      page,
                      commentRefreshPlan.since,
                      new Date(commentsSyncStartedAt).toISOString()
                    )
                  : {
                      changed: page.filter(
                        (comment) =>
                          !comment.createdAt ||
                          new Date(comment.createdAt).getTime() <=
                            commentsSyncStartedAt
                      ),
                      reachedCheckpoint: false,
                    };
              comments.push(...selected.changed);
              if (
                selected.reachedCheckpoint ||
                page.length < pageSize ||
                (response.pagination?.total !== undefined &&
                  offset + page.length >= response.pagination.total)
              ) {
                break;
              }
            }
            next =
              commentRefreshPlan.mode === "full"
                ? aggregateDiscussionComments(topics, comments, next)
                : mergeDiscussionCommentDelta(topics, comments, next);
            commentsSavedAt = commentsSyncStartedAt;
            if (commentRefreshPlan.mode === "full") {
              commentsFullSyncedAt = commentsSyncStartedAt;
            }
            if (!cancelled) {
              setStats({ ...next });
              writeJson(`${statsCacheKey}.${scope}`, {
                savedAt: Date.now(),
                commentsSavedAt,
                commentsFullSyncedAt,
                stats: next,
              } satisfies StatsCache);
            }
          } catch {
            // Keep the last successful counters when the server is offline.
          }
        }

        const viewIds = selectTopicViewRefreshIds(
          topics,
          next,
          Date.now(),
          statsRefresh > 0 ? 0 : VIEW_CACHE_TTL,
          VIEW_REFRESH_LIMIT
        );
        for (
          let offset = 0;
          offset < viewIds.length;
          offset += VIEW_REFRESH_CONCURRENCY
        ) {
          if (cancelled) {
            break;
          }
          const batchIds = viewIds.slice(
            offset,
            offset + VIEW_REFRESH_CONCURRENCY
          );
          const results = await Promise.allSettled(
            batchIds.map(async (id) => {
              const response = await client.post<{ data: unknown[] }>(
                "/views.list",
                { documentId: id }
              );
              return [id, (response.data ?? []).length] as const;
            })
          );
          const checkedAt = Date.now();
          for (const [id, count] of fulfilledRefreshEntries(results)) {
            next[id].viewCount = count;
            next[id].viewsCheckedAt = checkedAt;
          }
          if (!cancelled) {
            setStats({ ...next });
            writeJson(`${statsCacheKey}.${scope}`, {
              savedAt: Date.now(),
              commentsSavedAt,
              commentsFullSyncedAt,
              stats: next,
            } satisfies StatsCache);
          }
        }
      })();
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [forumCollectionId, scope, topics, statsRefresh]);

  React.useEffect(() => {
    let cancelled = false;
    void readPins(scope, async () => {
      const response = await client.post<{
        data:
          | { id: string; documentId: string }[]
          | { pins: { id: string; documentId: string }[] };
      }>("/pins.list", { limit: 100 });
      const data = response.data;
      const pinList = Array.isArray(data) ? data : (data?.pins ?? []);
      return Object.fromEntries(pinList.map((pin) => [pin.documentId, pin.id]));
    }, statsRefresh > 0).then((next) => {
      if (!cancelled) { setPins(next); }
    })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope, statsRefresh]);

  const createTopic = async () => {
    if (!title.trim() || creating || !forumCollectionId) {
      return;
    }
    setCreating(true);
    try {
      const response = await client.post<{ data: Topic }>("/documents.create", {
        title: title.trim(),
        text: "",
        collectionId: forumCollectionId,
        ...(selectedCategory ? { parentDocumentId: selectedCategory } : {}),
        publish: true,
      });
      setComposing(false);
      setTitle("");
      if (response.data) {
        setTopics((current) => [response.data, ...current.filter((topic) => topic.id !== response.data.id)]);
        localStorage.removeItem(`${topicCacheKey}.${scope}`);
        openInTab(history, tabs, {
          id: response.data.id,
          url:
            documents.get(response.data.id)?.url ?? `/doc/${response.data.id}`,
          title: response.data.title || title.trim(),
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发帖失败");
    } finally {
      setCreating(false);
    }
  };

  const toggleLike = (id: string) => {
    if (!user || !window.DesktopBridge) {
      return;
    }
    const liked = !likeData.topics[id]?.[user.id];
    const mutate = (current: LikeData): LikeData => {
      const users = { ...current.topics[id] };
      if (!liked) {
        delete users[user.id];
      } else {
        users[user.id] = {
          name: user.name ?? "",
          at: new Date().toISOString(),
        };
      }
      const topics = { ...current.topics };
      if (Object.keys(users).length) {
        topics[id] = users;
      } else {
        delete topics[id];
      }
      return { version: 1, topics };
    };
    setLikeData((current) => {
      const next = mutate(current);
      localStorage.setItem(`${likeCacheKey}.${scope}`, JSON.stringify(next));
      return next;
    });
    void enqueueWorkspaceWrite(`${scope}:${likesPath}`, async () => {
        const result = asWebdavResult(
          await window.DesktopBridge?.webdavGet(likesPath)
        );
        if (!result.ok) {
          throw new Error("无法读取共享点赞数据，请检查 WebDAV 设置。");
        }
        const latest =
          result.ok && result.data?.found
            ? parseLikes(result.data.content)
            : emptyLikes;
        const merged = mutate(latest);
        const saved = asWebdavResult(await window.DesktopBridge?.webdavPut(
          likesPath,
          JSON.stringify(merged, null, 2)
        ));
        if (!saved.ok) {
          throw new Error("点赞尚未同步，请检查 WebDAV 后重试。");
        }
        // Keep later optimistic clicks intact while the queue drains.
        localStorage.setItem(
          `${likeCacheKey}.${scope}`,
          JSON.stringify(merged)
        );
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "点赞同步失败"));
  };

  const togglePin = async (id: string) => {
    if (pinPending[id]) { return; }
    setPinPending((current) => ({ ...current, [id]: true }));
    try {
      if (pins[id]) {
        await client.post("/pins.delete", { id: pins[id] });
        setPins((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      } else {
        const response = await client.post<{ data: { id: string } }>(
          "/pins.create",
          { documentId: id }
        );
        setPins((current) => ({ ...current, [id]: response.data.id }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "置顶操作失败");
    } finally {
      setPinPending((current) => ({ ...current, [id]: false }));
    }
  };

  const visible = React.useMemo(() => visibleTopics(topics, pins, { category, query }), [topics, pins, category, query]);
  const pagination = useWorkspacePage(visible.length, JSON.stringify([category, query]));
  const pageItems = visible.slice(pagination.page * pagination.pageSize, (pagination.page + 1) * pagination.pageSize);
  const pinnedTopics = pageItems.filter((topic) => pins[topic.id]);
  const regularTopics = pageItems.filter((topic) => !pins[topic.id]);
  const categoryNames = new Map(
    categories.map((item) => [item.id, item.title])
  );
  const openTopic = (topic: Topic) => {
    const nextSeen = { ...seen, [topic.id]: new Date().toISOString() };
    setSeen(nextSeen);
    localStorage.setItem(`${seenKey}.${scope}`, JSON.stringify(nextSeen));
    openInTab(history, tabs, {
      id: topic.id,
      url: documents.get(topic.id)?.url ?? `/doc/${topic.id}`,
      title: topic.title || "无标题",
    });
  };
  const renderTopic = (topic: Topic) => {
    const activity = stats[topic.id];
    const lastActivity =
      activity?.lastActivity ?? topic.updatedAt ?? topic.createdAt;
    const unread = isTopicUnread(lastActivity, seen[topic.id]);
    const topicLikes = likeData.topics[topic.id] ?? {};
    const liked = !!(user && topicLikes[user.id]);
    const likeCount = Object.keys(topicLikes).length;
    return (
      <Row
        key={topic.id}
        role="button"
        tabIndex={0}
        onClick={() => openTopic(topic)}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            openTopic(topic);
          }
        }}
      >
        <UnreadDot
          $visible={unread}
          aria-label={unread ? "有新回复" : undefined}
        />
        <Avatar aria-hidden>
          {topic.createdBy?.avatarUrl ? (
            <img src={topic.createdBy.avatarUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            (topic.createdBy?.name ?? "成").slice(0, 1)
          )}
        </Avatar>
        <TopicMain>
          <TopicTitle $unread={unread}>
            {pins[topic.id] && <PinIcon size={13} aria-label="已置顶" />}
            {topic.title || "无标题"}
          </TopicTitle>
          <TopicMeta>
            <AuthorName>{topic.createdBy?.name ?? "成员"}</AuthorName>
            {topic.createdAt && (
              <span>· {formatTopicTime(topic.createdAt)}</span>
            )}
            {activity?.replyCount && lastActivity !== topic.updatedAt ? (
              <span>· 最后活跃 {formatTopicTime(lastActivity)}</span>
            ) : null}
            {topic.parentDocumentId &&
              categoryNames.get(topic.parentDocumentId) && (
                <TopicCategory>
                  {categoryNames.get(topic.parentDocumentId)}
                </TopicCategory>
              )}
          </TopicMeta>
        </TopicMain>
        <Metrics>
          <Metric title={`${activity?.viewCount ?? 0} 人阅读`}>
            <EyeIcon size={15} />
            <span>{activity ? activity.viewCount : "—"}</span>
          </Metric>
          <Metric title={`${activity?.replyCount ?? 0} 条回复`}>
            <CommentIcon size={15} />
            <span>{activity ? activity.replyCount : "—"}</span>
          </Metric>
          <Tooltip content={liked ? "取消点赞" : "点赞"} placement="bottom">
            <IconButton
              type="button"
              aria-label={liked ? "取消点赞" : "点赞"}
              aria-pressed={liked}
              disabled={!user || !window.DesktopBridge}
              $active={liked}
              onClick={(event) => {
                event.stopPropagation();
                toggleLike(topic.id);
              }}
            >
              <ThumbsUpIcon size={15} />
              <span>{likeCount}</span>
            </IconButton>
          </Tooltip>
          <Tooltip
            content={pins[topic.id] ? "取消置顶" : "置顶"}
            placement="bottom"
          >
            <PinButton
              type="button"
              aria-label={pins[topic.id] ? "取消置顶" : "置顶"}
              aria-pressed={!!pins[topic.id]}
              disabled={!!pinPending[topic.id]}
              $active={!!pins[topic.id]}
              onClick={(event) => {
                event.stopPropagation();
                void togglePin(topic.id);
              }}
            >
              <PinIcon size={15} />
            </PinButton>
          </Tooltip>
        </Metrics>
      </Row>
    );
  };

  return (
    <Scene
      icon={<CommentIcon />}
      title="讨论区"
      textTitle="讨论区"
      wide
      hideHeaderOnDesktop
    >
      <Board>
        <FeatureHeader>
          <HeaderCopy>
            <PageHeading>讨论区</PageHeading>
            <Intro>
              主题即文档，回复使用官方评论；高质量讨论可继续沉淀进知识库。
            </Intro>
          </HeaderCopy>
          <HeaderSide>
            <FeatureStats>
              {topics.length
                ? `${topics.length} 个主题 · ${Object.values(stats).reduce(
                    (total, item) => total + item.replyCount,
                    0
                  )} 条回复`
                : loading ? "准备加载中" : "暂无讨论"}
            </FeatureStats>
            <Actions>
              <ButtonSmall
                neutral
                onClick={() => void load(true)}
                disabled={loading || refreshing}
              >
                {loading || refreshing ? "刷新中…" : "刷新"}
              </ButtonSmall>
              <ButtonSmall disabled={!forumCollectionId || loading} onClick={() => setComposing(true)}>
                <CommentIcon size={15} />
                发起讨论
              </ButtonSmall>
            </Actions>
          </HeaderSide>
        </FeatureHeader>

        <Toolbar>
          <SearchBox>
            <InputSearch
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索讨论主题…"
            />
          </SearchBox>
        </Toolbar>

        {composing && (
          <ComposerPanel>
            <ComposerTitle>发起一个新讨论</ComposerTitle>
            <ComposerFields>
              <ComposerInput
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    void createTopic();
                  }
                  if (event.key === "Escape") {
                    setComposing(false);
                  }
                }}
                aria-label="讨论标题"
                disabled={creating}
                placeholder="用一句话写下讨论主题…"
              />
              <ComposerSelect
                aria-label="讨论版块"
                disabled={creating}
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
              >
                <option value="">不分版块</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </ComposerSelect>
              <ButtonSmall
                onClick={() => void createTopic()}
                disabled={!title.trim() || creating || !forumCollectionId}
              >
                {creating ? "发布中…" : "发布"}
              </ButtonSmall>
              <ButtonSmall neutral onClick={() => setComposing(false)}>
                取消
              </ButtonSmall>
            </ComposerFields>
          </ComposerPanel>
        )}

        {categories.length > 0 && (
          <CategoryBar role="tablist" aria-label="讨论版块">
            <Category
              type="button"
              role="tab"
              aria-selected={!category}
              $active={!category}
              onClick={() => setCategory(null)}
            >
              全部 <CategoryCount>{topics.length}</CategoryCount>
            </Category>
            {categories.map((item) => {
              const count = topics.filter(
                (topic) => topic.parentDocumentId === item.id
              ).length;
              return (
                <Category
                  type="button"
                  role="tab"
                  aria-selected={category === item.id}
                  key={item.id}
                  $active={category === item.id}
                  onClick={() =>
                    setCategory(category === item.id ? null : item.id)
                  }
                >
                  {item.title} <CategoryCount>{count}</CategoryCount>
                </Category>
              );
            })}
          </CategoryBar>
        )}

        {error && <ErrorText role="alert">{error}</ErrorText>}
        {(category || query.trim()) && (
          <Summary>
            <strong>{visible.length}</strong> 个主题
            {category && categoryNames.get(category)
              ? ` · ${categoryNames.get(category)}`
              : ""}
            {query.trim() ? ` · 搜索“${query.trim()}”` : ""}
          </Summary>
        )}
        {loading ? (
          <Empty>正在加载讨论主题…</Empty>
        ) : !forumFound ? (
          <Empty>尚未找到“讨论区”或“论坛空间”集合。</Empty>
        ) : visible.length === 0 ? (
          <Empty>{topics.length === 0 ? "还没有讨论，发起第一个主题吧。" : <>没有匹配的讨论。<ButtonSmall neutral onClick={() => { setQuery(""); setCategory(null); }}>清除筛选</ButtonSmall></>}</Empty>
        ) : (
          <List>
            {pinnedTopics.length > 0 && <GroupLabel>置顶讨论</GroupLabel>}
            {pinnedTopics.map(renderTopic)}
            {pinnedTopics.length > 0 && regularTopics.length > 0 && (
              <GroupLabel>其他讨论</GroupLabel>
            )}
            {regularTopics.map(renderTopic)}
          </List>
        )}
        <WorkspacePagination {...pagination} total={visible.length} onChange={pagination.setPage} />
      </Board>
    </Scene>
  );
}

export default observer(function Discuss() {
  const { auth } = useStores();
  return <DiscussWorkspace key={auth.currentTeamId ?? window.location.host} />;
});

const Board = styled.div`
  width: min(100%, 1160px);
  box-sizing: border-box;
  margin: 0 auto;
  padding: 24px clamp(16px, 3vw, 32px) 48px;

  @media (max-width: 700px) {
    padding: 12px 16px 40px;
  }
`;
const Actions = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;

  svg {
    margin-right: 5px;
    vertical-align: -3px;
  }
`;
const FeatureHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin: 8px 0 20px;

  @media (max-width: 860px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;
const HeaderCopy = styled.div`
  min-width: 0;
`;
const PageHeading = styled.h1`
  margin: 0 0 5px;
  color: ${(props) => props.theme.text};
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.2;
`;
const HeaderSide = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  flex-shrink: 0;

  @media (max-width: 860px) {
    width: 100%;
    justify-content: space-between;
  }
`;
const FeatureStats = styled.div`
  flex-shrink: 0;
  padding: 5px 9px;
  border-radius: 7px;
  color: ${(props) => props.theme.textTertiary};
  background: ${(props) => props.theme.backgroundSecondary};
  font-size: 13px;
`;
const Intro = styled.p`
  margin: 0;
  max-width: 720px;
  color: ${(p) => p.theme.textTertiary};
  font-size: 14px;
  line-height: 1.5;
`;
const Toolbar = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 12px;
  padding: 12px 0;
  border-bottom: 1px solid ${(p) => p.theme.divider};
  background: ${(p) => p.theme.background};

  @media (max-width: 700px) {
    align-items: stretch;
    flex-direction: column;
  }
`;
const SearchBox = styled.div`
  flex: 1;
  min-width: min(220px, 100%);
`;
const ComposerPanel = styled.section`
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid ${(p) => p.theme.divider};
  border-left: 3px solid ${(p) => p.theme.accent};
  border-radius: 8px;
  background: ${(p) => p.theme.backgroundSecondary};
`;
const ComposerTitle = styled.div`
  margin-bottom: 10px;
  color: ${(p) => p.theme.text};
  font-size: 13px;
  font-weight: 600;
`;
const ComposerFields = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;

  @media (max-width: 700px) {
    align-items: stretch;
    flex-direction: column;
  }
`;
const ComposerInput = styled.input`
  min-width: 0;
  flex: 1;
  height: 32px;
  padding: 0 9px;
  border: 1px solid ${(p) => p.theme.divider};
  border-radius: 6px;
  color: ${(p) => p.theme.text};
  background: ${(p) => p.theme.background};
  font: inherit;
`;
const ComposerSelect = styled.select`
  height: 32px;
  padding: 0 8px;
  border: 1px solid ${(p) => p.theme.divider};
  border-radius: 6px;
  color: ${(p) => p.theme.text};
  background: ${(p) => p.theme.background};
  font: inherit;
`;
const CategoryBar = styled.div`
  display: flex;
  gap: 7px;
  margin-bottom: 14px;
  padding: 0 0 2px;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;
const Category = styled.button<{ $active: boolean }>`
  display: inline-flex;
  gap: 5px;
  align-items: center;
  flex-shrink: 0;
  padding: 5px 10px;
  border: 1px solid ${(p) => (p.$active ? p.theme.accent : p.theme.divider)};
  border-radius: 6px;
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textTertiary)};
  background: ${(p) =>
    p.$active ? p.theme.backgroundSecondary : p.theme.background};
  font-size: 13px;
  cursor: pointer;

  &:hover {
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.backgroundSecondary};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: 1px;
  }
`;
const CategoryCount = styled.span`
  color: ${(p) => p.theme.textTertiary};
  font-size: 11px;
`;
const ErrorText = styled.p`
  margin: 10px 0;
  padding: 8px 10px;
  border-left: 2px solid ${(p) => p.theme.danger};
  color: ${(p) => p.theme.danger};
  background: ${(p) => p.theme.backgroundSecondary};
  font-size: 13px;
`;
const Summary = styled.div`
  margin: 10px 0 6px;
  color: ${(p) => p.theme.textTertiary};
  font-size: 13px;

  strong {
    color: ${(p) => p.theme.text};
    font-weight: 600;
  }
`;
const List = styled.div`
  display: flex;
  flex-direction: column;
  border-top: 1px solid ${(p) => p.theme.divider};
`;
const GroupLabel = styled.div`
  padding: 13px 10px 7px;
  color: ${(p) => p.theme.textTertiary};
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;
const Row = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 16px 8px;
  @media (max-width: 600px) { flex-wrap: wrap; > :last-child { margin-left: 53px; } }
  border-bottom: 1px solid ${(p) => p.theme.divider};
  border-radius: 5px;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;

  &:hover {
    background: ${(p) => p.theme.backgroundSecondary};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: -2px;
  }
`;
const UnreadDot = styled.span<{ $visible: boolean }>`
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${(p) => (p.$visible ? p.theme.accent : "transparent")};
`;
const Avatar = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 50%;
  color: ${(props) => props.theme.textSecondary};
  background: ${(props) => props.theme.sidebarActiveBackground};
  font-size: 13px;
  font-weight: 600;

  img {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    object-fit: cover;
  }
`;
const TopicMain = styled.div`
  min-width: 0;
  flex: 1;
`;
const TopicTitle = styled.div<{ $unread: boolean }>`
  display: block;
  gap: 5px;
  align-items: center;
  overflow: hidden;
  color: ${(p) => p.theme.text};
  font-size: 16px;
  font-weight: ${(p) => p.$unread ? 600 : 500};
  text-overflow: ellipsis;
  white-space: nowrap;

  svg {
    display: inline-block;
    vertical-align: -2px;
    margin-right: 5px;
    color: ${(p) => p.theme.accent};
  }
`;
const TopicMeta = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 5px;
  overflow: hidden;
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  flex-wrap: wrap;
  white-space: normal;
`;
const AuthorName = styled.span`
  color: ${(p) => p.theme.textSecondary};
  font-weight: 500;
`;
const TopicCategory = styled.span`
  overflow: hidden;
  padding: 1px 6px;
  border: 1px solid ${(p) => p.theme.divider};
  border-radius: 6px;
  color: ${(p) => p.theme.textSecondary};
  background: ${(p) => p.theme.backgroundSecondary};
  text-overflow: ellipsis;
`;
const Metrics = styled.div`
  display: flex;
  gap: 4px;
  align-items: center;
  flex-shrink: 0;

  @media (max-width: 760px) {
    > :first-child {
      display: none;
    }
  }
`;
const Metric = styled.span`
  display: inline-flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  color: ${(p) => p.theme.textSecondary};
  font-size: 12px;

  svg {
    flex-shrink: 0;
  }
`;
const IconButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 28px;
  gap: 4px;
  padding: 0 7px;
  border: 0;
  border-radius: 5px;
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textTertiary)};
  background: transparent;
  cursor: pointer;

  &:hover {
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.backgroundTertiary};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: -1px;
  }
`;
const PinButton = styled(IconButton)`
  min-width: 28px;
  width: 28px;
  opacity: ${(p) => (p.$active ? 1 : 0)};

  ${Row}:hover &,
  &:focus-visible {
    opacity: 1;
  }
`;

