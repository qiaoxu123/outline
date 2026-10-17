export type TopicLike = {
  id: string;
  title: string;
  parentDocumentId?: string | null;
  updatedAt?: string;
  createdAt?: string;
  createdBy?: { name?: string };
};

export type DiscussionTopicStats = {
  replyCount: number;
  viewCount: number;
  lastActivity: string;
  viewsCheckedAt?: number;
};

export type DiscussionComment = {
  id?: string;
  documentId: string;
  createdAt?: string;
};

export type TopicSort = "activity" | "newest" | "replies" | "views";

export type TopicListOptions = {
  category: string | null;
  query: string;
  sort?: TopicSort;
  unreadOnly?: boolean;
  seen?: Record<string, string>;
  firstOpenedAt?: string;
};

export type DiscussionTopicRefreshState = {
  savedAt: number;
  metadataSyncedAt?: number;
  fullSyncedAt?: number;
  complete?: boolean;
};

export type DiscussionTopicRefreshPlan =
  | { mode: "full" }
  | { mode: "changed"; since: string };

export function planDiscussionTopicRefresh(
  cache: DiscussionTopicRefreshState | null,
  now: number,
  fullRefreshTtl: number
): DiscussionTopicRefreshPlan {
  if (
    !cache?.complete ||
    !cache.fullSyncedAt ||
    now - cache.fullSyncedAt >= fullRefreshTtl
  ) {
    return { mode: "full" };
  }
  const checkpoint = cache.metadataSyncedAt ?? cache.savedAt;
  if (!Number.isFinite(checkpoint) || checkpoint <= 0) {
    return { mode: "full" };
  }
  return { mode: "changed", since: new Date(checkpoint).toISOString() };
}

/**
 * The current collection tree owns membership, title, and category. Cached and
 * refreshed list data only hydrate details that the tree endpoint omits.
 */
export function mergeDiscussionTopics<T extends TopicLike>(
  indexed: TopicLike[],
  cached: T[],
  refreshed: T[]
): T[] {
  const cachedById = new Map(cached.map((topic) => [topic.id, topic]));
  const refreshedById = new Map(refreshed.map((topic) => [topic.id, topic]));

  return indexed.map(
    (topic) =>
      ({
        ...cachedById.get(topic.id),
        ...refreshedById.get(topic.id),
        ...topic,
      }) as T
  );
}

/** Latest discussion activity (replies included) determines default order. */
export function visibleTopics<T extends TopicLike>(
  topics: T[],
  pins: Record<string, string>,
  options: TopicListOptions,
  stats: Record<string, DiscussionTopicStats> = {}
): T[] {
  const query = options.query.trim().toLocaleLowerCase();
  const lastActivity = (topic: T) =>
    stats[topic.id]?.lastActivity || topic.updatedAt || topic.createdAt || "";
  const timestamp = (value: string | undefined): number => {
    const valueMs = value ? new Date(value).getTime() : 0;
    return Number.isFinite(valueMs) ? valueMs : 0;
  };
  return topics
    .filter((topic) => {
      if (options.category && topic.parentDocumentId !== options.category) {
        return false;
      }
      if (query && ![topic.title, topic.createdBy?.name ?? ""]
        .join(" ").toLocaleLowerCase().includes(query)) {
        return false;
      }
      return !options.unreadOnly || isTopicUnread(
        lastActivity(topic), options.seen?.[topic.id] ?? options.firstOpenedAt
      );
    })
    .sort((a, b) => {
      const pinned = Number(!!pins[b.id]) - Number(!!pins[a.id]);
      if (pinned) return pinned;
      const order = options.sort ?? "activity";
      let difference = 0;
      if (order === "newest") difference = timestamp(b.createdAt) - timestamp(a.createdAt);
      else if (order === "replies") difference = (stats[b.id]?.replyCount ?? 0) - (stats[a.id]?.replyCount ?? 0);
      else if (order === "views") difference = (stats[b.id]?.viewCount ?? 0) - (stats[a.id]?.viewCount ?? 0);
      else difference = timestamp(lastActivity(b)) - timestamp(lastActivity(a));
      return difference || timestamp(b.createdAt) - timestamp(a.createdAt) ||
        a.id.localeCompare(b.id);
    });
}

export function formatTopicTime(
  value: string | undefined,
  now = new Date()
): string {
  if (!value) {
    return "";
  }
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "";
  }
  const minutes = Math.max(0, Math.floor((now.getTime() - timestamp) / 60000));
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} 天前`;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year:
      now.getFullYear() === new Date(timestamp).getFullYear()
        ? undefined
        : "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

export function isTopicUnread(
  lastActivityAt: string | undefined,
  seenAt: string | undefined
): boolean {
  if (!lastActivityAt || !seenAt) {
    return false;
  }
  const activity = new Date(lastActivityAt).getTime();
  const seen = new Date(seenAt).getTime();
  return !Number.isNaN(activity) && !Number.isNaN(seen) && activity > seen;
}

/** Aggregate one collection-level comment response into per-topic counters. */
export function aggregateDiscussionComments<T extends TopicLike>(
  topics: T[],
  comments: DiscussionComment[],
  previous: Record<string, DiscussionTopicStats>
): Record<string, DiscussionTopicStats> {
  const next = Object.fromEntries(
    topics.map((topic) => {
      const cached = previous[topic.id];
      return [
        topic.id,
        {
          replyCount: 0,
          viewCount: cached?.viewCount ?? 0,
          lastActivity: topic.updatedAt ?? topic.createdAt ?? "",
          ...(cached?.viewsCheckedAt !== undefined
            ? { viewsCheckedAt: cached.viewsCheckedAt }
            : {}),
        },
      ];
    })
  ) as Record<string, DiscussionTopicStats>;

  for (const comment of comments) {
    const topic = next[comment.documentId];
    if (!topic) {
      continue;
    }
    topic.replyCount += 1;
    if (comment.createdAt && comment.createdAt > topic.lastActivity) {
      topic.lastActivity = comment.createdAt;
    }
  }
  return next;
}

/** Add only comments newer than the last successful collection checkpoint. */
export function mergeDiscussionCommentDelta<T extends TopicLike>(
  topics: T[],
  comments: DiscussionComment[],
  previous: Record<string, DiscussionTopicStats>
): Record<string, DiscussionTopicStats> {
  const next = Object.fromEntries(
    topics.map((topic) => {
      const cached = previous[topic.id];
      return [
        topic.id,
        cached
          ? { ...cached }
          : {
              replyCount: 0,
              viewCount: 0,
              lastActivity: topic.updatedAt ?? topic.createdAt ?? "",
            },
      ];
    })
  ) as Record<string, DiscussionTopicStats>;

  for (const comment of comments) {
    const topic = next[comment.documentId];
    if (!topic) {
      continue;
    }
    topic.replyCount += 1;
    if (comment.createdAt && comment.createdAt > topic.lastActivity) {
      topic.lastActivity = comment.createdAt;
    }
  }
  return next;
}

/** Pick a bounded set of stale discussion view counters for background work. */
export function selectTopicViewRefreshIds<T extends TopicLike>(
  topics: T[],
  stats: Record<string, DiscussionTopicStats>,
  now: number,
  ttl: number,
  limit: number
): string[] {
  return topics
    .map((topic, index) => ({
      id: topic.id,
      checkedAt: stats[topic.id]?.viewsCheckedAt ?? Number.NEGATIVE_INFINITY,
      index,
    }))
    .filter((item) => now - item.checkedAt >= ttl)
    .sort((a, b) => a.checkedAt - b.checkedAt || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((item) => item.id);
}
