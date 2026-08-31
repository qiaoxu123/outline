import { AcademicCapIcon } from "outline-icons";
import * as React from "react";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import Empty from "~/components/Empty";
import InputSearch from "~/components/InputSearch";
import Scene from "~/components/Scene";
import useStores from "~/hooks/useStores";
import useCurrentUser from "~/hooks/useCurrentUser";
import { client } from "~/utils/ApiClient";
import { openInTab } from "~/utils/tabNavigation";
import {
  collectionDocuments,
  listCollections,
  type CustomDocument,
} from "./customData";

type Scope = "all" | "liked" | "history";
type ReadState = "unread" | "reading" | "read";
type Paper = CustomDocument & {
  emoji?: string | null;
  year?: number | null;
  month?: number | null;
  topic?: string | null;
};
type Meta = {
  tags: string[];
  venue: string | null;
  link: string | null;
  code: string | null;
  enTitle: string | null;
};

const PAPER = "📖";
const readKey = "outline.desktop.papers.read.v1";
const likesKey = "outline.desktop.papers.likes.v1";
const interactionPath = "论文库/interactions.json";
type InteractionData = {
  version: 1;
  papers: Record<
    string,
    Record<string, { like?: boolean; score?: number; at: string }>
  >;
};
type Rating = { average: number; count: number; mine: number | null };

function flatten(tree: CustomDocument[]): CustomDocument[] {
  const result: CustomDocument[] = [];
  const pending = [...tree];
  while (pending.length) {
    const item = pending.shift()!;
    result.push(item);
    pending.unshift(...(item.children ?? []));
  }
  return result;
}

function collectRecommendation(
  nodes: CustomDocument[],
  year: number | null = null,
  month: number | null = null,
): Paper[] {
  return nodes.flatMap((node) => {
    const title = node.title.trim();
    const y = /^(\d{4})\s*年/.exec(title);
    const m = /^(\d{1,2})\s*月/.exec(title);
    if (y)
      return collectRecommendation(node.children ?? [], Number(y[1]), month);
    if (m)
      return collectRecommendation(node.children ?? [], year, Number(m[1]));
    return [{ ...node, year, month }];
  });
}

function collectFeatured(
  nodes: CustomDocument[],
  topic: string | null = null,
  source = "featured",
): Paper[] {
  return nodes.flatMap((node) => {
    const title = node.title.trim();
    if (title.startsWith(PAPER))
      return [
        { ...node, title, topic, source } as Paper,
        ...collectFeatured(node.children ?? [], topic, source),
      ];
    return collectFeatured(node.children ?? [], topic ?? title, source);
  });
}

function parseMeta(text: string | undefined): Meta {
  const fields = new Map<string, string>();
  for (const line of (text ?? "").split("\n").slice(0, 45)) {
    const match = /^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line.trim());
    if (match && !/^[-\s:]+$/.test(match[1]))
      fields.set(match[1].trim(), match[2].trim());
  }
  const pick = (...keys: string[]) =>
    [...fields].find(([name]) => keys.some((key) => name.includes(key)))?.[1] ??
    null;
  const extractUrl = (value: string | null) =>
    value
      ? (/\((https?:\/\/[^)]+)\)/.exec(value)?.[1] ??
        (value.startsWith("http") ? value : null))
      : null;
  const title = pick(
    "英文标题",
    "原文标题",
    "原标题",
    "英文题目",
    "论文标题",
    "Title",
  );
  return {
    tags: (pick("领域", "方向", "标签") ?? "")
      .split(/[,，、;；|]/)
      .map((tag) => tag.replace(/[*_`]/g, "").trim())
      .filter(Boolean),
    venue: pick("发表时间", "发表", "venue"),
    link: extractUrl(pick("论文链接", "链接")),
    code: extractUrl(pick("代码仓库", "代码", "源码", "GitHub")),
    enTitle:
      title
        ?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .trim() || null,
  };
}

function readMap(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

export default function Papers() {
  const { documents, tabs, auth } = useStores();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const history = useHistory();
  const [papers, setPapers] = React.useState<Paper[]>([]);
  const [metas, setMetas] = React.useState<Record<string, Meta>>({});
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<Scope>("all");
  const [readFilter, setReadFilter] = React.useState<ReadState | "">("");
  const [sort, setSort] = React.useState("updated");
  const [tag, setTag] = React.useState<string | null>(null);
  const scopedReadKey = `${readKey}.${auth.currentTeamId ?? window.location.host}`;
  const scopedLikesKey = `${likesKey}.${auth.currentTeamId ?? window.location.host}`;
  const [read, setRead] = React.useState(readMap(scopedReadKey));
  const [likes, setLikes] = React.useState(readMap(scopedLikesKey));
  const [ratings, setRatings] = React.useState<Record<string, Rating>>({});
  const [viewCounts, setViewCounts] = React.useState<Record<string, number>>(
    {},
  );
  const [viewed, setViewed] = React.useState<Record<string, string>>(() =>
    readMap(`${readKey}.history.${auth.currentTeamId ?? window.location.host}`),
  );

  React.useEffect(() => {
    let cancelled = false;
    window.DesktopBridge?.webdavGet(interactionPath)
      .then((result: any) => {
        if (cancelled || !result?.ok || !result.data?.found) return;
        try {
          const remote = JSON.parse(result.data.content) as InteractionData;
          const next = Object.fromEntries(
            Object.entries(remote.papers ?? {}).map(([id, entries]) => [
              id,
              !!entries[user?.id ?? ""]?.like,
            ]),
          );
          const nextRatings = Object.fromEntries(
            Object.entries(remote.papers ?? {}).flatMap(([id, entries]) => {
              const scores = Object.values(entries)
                .map((entry) => entry.score)
                .filter((score): score is number => typeof score === "number");
              return scores.length
                ? [
                    [
                      id,
                      {
                        average:
                          scores.reduce((sum, score) => sum + score, 0) /
                          scores.length,
                        count: scores.length,
                        mine: entries[user?.id ?? ""]?.score ?? null,
                      } as Rating,
                    ],
                  ]
                : [];
            }),
          );
          setLikes(next);
          setRatings(nextRatings);
          localStorage.setItem(scopedLikesKey, JSON.stringify(next));
        } catch {
          /* malformed shared data falls back to local cache */
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scopedLikesKey, user?.id]);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.allSettled(
      papers.slice(0, 200).map(async (paper) => {
        const response = await client.post<{
          data: { views?: { count?: number }[] };
        }>("/views.list", { documentId: paper.id });
        return [
          paper.id,
          (response.data?.views ?? []).reduce(
            (total, view) => total + (view.count ?? 1),
            0,
          ),
        ] as const;
      }),
    ).then((results) => {
      if (!cancelled)
        setViewCounts(
          Object.fromEntries(
            results.flatMap((result) =>
              result.status === "fulfilled" ? [result.value] : [],
            ),
          ),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [papers]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const collections = await listCollections();
        const trees = await Promise.all(
          collections.map(async (collection) => ({
            collection,
            tree: await collectionDocuments(collection.id),
          })),
        );
        const found: Paper[] = [];
        for (const { collection, tree } of trees) {
          const root = flatten(tree).find(
            (item) => item.title.trim() === "推荐阅读",
          );
          if (root) found.push(...collectRecommendation(root.children ?? []));
          if (collection.name.trim() === "组内工作")
            found.push(
              ...flatten(tree)
                .filter((item) => item.title.trim().startsWith(PAPER))
                .map(
                  (item) =>
                    ({
                      ...item,
                      topic: "组内工作",
                      source: "internal",
                    }) as Paper,
                ),
            );
          if (collection.name.trim() === "精选专题")
            found.push(...collectFeatured(tree));
        }
        const search = await client.post<{ data: CustomDocument[] }>(
          "/documents.list",
          { query: "📖", sort: "updatedAt", direction: "DESC", limit: 100 },
        );
        found.push(
          ...((search.data ?? []).filter((item) =>
            item.title.trim().startsWith(PAPER),
          ) as Paper[]),
        );
        const unique = [
          ...new Map(found.map((item) => [item.id, item])).values(),
        ];
        const details = await Promise.all(
          unique.map(async (item) => {
            try {
              const response = await client.post<{
                data: CustomDocument & { text?: string };
              }>("/documents.info", { id: item.id });
              return [item.id, parseMeta(response.data?.text)] as const;
            } catch {
              return [item.id, parseMeta(undefined)] as const;
            }
          }),
        );
        const nextMetas = Object.fromEntries(details) as Record<string, Meta>;
        if (!cancelled) {
          setPapers(unique);
          setMetas(nextMetas);
        }
      } catch (error) {
        console.error("[papers] load failed", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allTags = React.useMemo(
    () =>
      [...new Set(Object.values(metas).flatMap((meta) => meta.tags))].slice(
        0,
        24,
      ),
    [metas],
  );
  const visible = React.useMemo(
    () =>
      papers
        .filter((paper) => {
          const meta = metas[paper.id] ?? {};
          const state = (read[paper.id] as ReadState | undefined) ?? "unread";
          if (scope === "liked" && !likes[paper.id]) return false;
          if (scope === "history" && !viewed[paper.id]) return false;
          if (readFilter && state !== readFilter) return false;
          if (tag && !meta.tags?.includes(tag)) return false;
          const haystack =
            `${paper.title} ${meta.enTitle ?? ""} ${meta.venue ?? ""} ${(meta.tags ?? []).join(" ")}`.toLowerCase();
          return haystack.includes(query.trim().toLowerCase());
        })
        .sort((a, b) =>
          sort === "title"
            ? a.title.localeCompare(b.title, "zh")
            : sort === "views"
              ? (viewCounts[b.id] ?? 0) - (viewCounts[a.id] ?? 0)
              : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
        ),
    [
      papers,
      metas,
      query,
      scope,
      readFilter,
      tag,
      sort,
      read,
      likes,
      viewed,
      viewCounts,
    ],
  );

  const cycleRead = (id: string) => {
    const next = {
      ...read,
      [id]:
        read[id] === "unread"
          ? "reading"
          : read[id] === "reading"
            ? "read"
            : "unread",
    };
    setRead(next);
    localStorage.setItem(scopedReadKey, JSON.stringify(next));
  };
  const toggleLike = (id: string) => {
    if (!user) return;
    const next = { ...likes };
    const liked = !next[id];
    if (liked) next[id] = "1";
    else delete next[id];
    setLikes(next);
    localStorage.setItem(scopedLikesKey, JSON.stringify(next));
    void (async () => {
      try {
        const currentResult: any =
          await window.DesktopBridge?.webdavGet(interactionPath);
        const current: InteractionData = currentResult?.data?.found
          ? JSON.parse(currentResult.data.content)
          : { version: 1, papers: {} };
        const paper = { ...(current.papers[id] ?? {}) };
        if (liked)
          paper[user.id] = {
            ...(paper[user.id] ?? {}),
            like: true,
            at: new Date().toISOString(),
          };
        else {
          const entry = { ...(paper[user.id] ?? {}) };
          delete entry.like;
          if (entry.at) paper[user.id] = entry;
          else delete paper[user.id];
        }
        if (Object.keys(paper).length) current.papers[id] = paper;
        else delete current.papers[id];
        await window.DesktopBridge?.webdavPut(
          interactionPath,
          JSON.stringify(current, null, 2),
        );
      } catch (error) {
        console.error("[papers] shared like write failed", error);
      }
    })();
  };
  const setScore = (id: string) => {
    if (!user) return;
    const current = ratings[id]?.mine ?? 0;
    const score = current >= 5 ? null : current + 1;
    setRatings((previous) => ({
      ...previous,
      [id]: { average: score ?? 0, count: score ? 1 : 0, mine: score },
    }));
    void (async () => {
      try {
        const result: any =
          await window.DesktopBridge?.webdavGet(interactionPath);
        const data: InteractionData = result?.data?.found
          ? JSON.parse(result.data.content)
          : { version: 1, papers: {} };
        const paper = { ...(data.papers[id] ?? {}) };
        const entry = {
          ...(paper[user.id] ?? {}),
          at: new Date().toISOString(),
        };
        if (score) entry.score = score;
        else delete entry.score;
        if (entry.like || entry.score) paper[user.id] = entry;
        else delete paper[user.id];
        if (Object.keys(paper).length) data.papers[id] = paper;
        else delete data.papers[id];
        await window.DesktopBridge?.webdavPut(
          interactionPath,
          JSON.stringify(data, null, 2),
        );
      } catch (error) {
        console.error("[papers] shared score write failed", error);
      }
    })();
  };
  const open = (paper: Paper) => {
    const nextViewed = { ...viewed, [paper.id]: new Date().toISOString() };
    setViewed(nextViewed);
    localStorage.setItem(
      `${readKey}.history.${auth.currentTeamId ?? window.location.host}`,
      JSON.stringify(nextViewed),
    );
    setViewCounts((current) => ({
      ...current,
      [paper.id]: (current[paper.id] ?? 0) + 1,
    }));
    void client
      .post("/views.create", { documentId: paper.id })
      .catch(() => undefined);
    openInTab(history, tabs, {
      id: paper.id,
      url: documents.get(paper.id)?.url ?? `/doc/${paper.id}`,
      title: paper.title.replace(/^📖\s*/, ""),
      emoji: paper.emoji,
    });
  };

  return (
    <Scene icon={<AcademicCapIcon />} title="论文库" textTitle="论文库" wide>
      <Toolbar>
        <ScopeBar>
          {(["all", "liked", "history"] as Scope[]).map((item) => (
            <ScopeButton
              key={item}
              $active={scope === item}
              onClick={() => setScope(item)}
            >
              {item === "all"
                ? "全部"
                : item === "liked"
                  ? `我赞过 · ${Object.keys(likes).length}`
                  : "最近浏览"}
            </ScopeButton>
          ))}
        </ScopeBar>
        <InputSearch
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、作者、领域或会议…"
        />
      </Toolbar>
      <Filters>
        <select
          value={readFilter}
          onChange={(event) =>
            setReadFilter(event.target.value as ReadState | "")
          }
        >
          <option value="">全部阅读状态</option>
          <option value="unread">未读</option>
          <option value="reading">在读</option>
          <option value="read">已读</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="updated">更新时间 新→旧</option>
          <option value="views">阅读次数 多→少</option>
          <option value="title">标题 A→Z</option>
        </select>
      </Filters>
      {allTags.length > 0 && (
        <TagBar>
          {allTags.map((item) => (
            <Tag
              key={item}
              $active={tag === item}
              onClick={() => setTag(tag === item ? null : item)}
            >
              {item}
            </Tag>
          ))}
        </TagBar>
      )}
      <Summary>
        共 {visible.length} 篇 · 已读{" "}
        {Object.values(read).filter((value) => value === "read").length} 篇
      </Summary>
      {loading ? (
        <Empty>正在加载论文库…</Empty>
      ) : visible.length === 0 ? (
        <Empty>没有匹配的论文。</Empty>
      ) : (
        <List>
          {visible.map((paper) => {
            const meta = metas[paper.id] ?? { tags: [] };
            const state = read[paper.id] ?? "unread";
            return (
              <Row key={paper.id} onClick={() => open(paper)}>
                <Main>
                  <Title>
                    {paper.emoji ?? "📖"} {paper.title.replace(/^📖\s*/, "")}
                  </Title>
                  <MetaLine>
                    {meta.enTitle && <span>{meta.enTitle}</span>}
                    {meta.venue && <span>{meta.venue}</span>}
                    <span>{viewCounts[paper.id] ?? 0} 次阅读</span>
                    {meta.tags?.slice(0, 4).map((item) => (
                      <Tag
                        key={item}
                        onClick={(event) => {
                          event.stopPropagation();
                          setTag(item);
                        }}
                      >
                        {item}
                      </Tag>
                    ))}
                  </MetaLine>
                </Main>
                <Actions>
                  <LikeButton
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleLike(paper.id);
                    }}
                    $active={!!likes[paper.id]}
                  >
                    ♥ {likes[paper.id] ? "已赞" : "点赞"}
                  </LikeButton>
                  <ScoreButton
                    onClick={(event) => {
                      event.stopPropagation();
                      setScore(paper.id);
                    }}
                    $active={!!ratings[paper.id]?.mine}
                    title="点击评分，循环 1–5 星；第 5 次后清除评分"
                  >
                    ★{" "}
                    {ratings[paper.id]?.average
                      ? ratings[paper.id].average.toFixed(1)
                      : "评分"}
                  </ScoreButton>
                  {meta.link && (
                    <a
                      href={meta.link}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      原文
                    </a>
                  )}
                  {meta.code && (
                    <a
                      href={meta.code}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      代码
                    </a>
                  )}
                  <ReadButton
                    onClick={(event) => {
                      event.stopPropagation();
                      cycleRead(paper.id);
                    }}
                    $state={state}
                  >
                    {state === "read"
                      ? "已读"
                      : state === "reading"
                        ? "在读"
                        : "未读"}
                  </ReadButton>
                </Actions>
              </Row>
            );
          })}
        </List>
      )}
    </Scene>
  );
}

const Toolbar = styled.div`
  display: flex;
  gap: 16px;
  align-items: center;
  margin: 20px 0 12px;
  @media (max-width: 700px) {
    flex-direction: column;
    align-items: stretch;
  }
`;
const ScopeBar = styled.div`
  display: flex;
  gap: 4px;
  flex-shrink: 0;
`;
const ScopeButton = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 6px;
  padding: 7px 10px;
  color: ${(p) => (p.$active ? p.theme.text : p.theme.textTertiary)};
  background: ${(p) => (p.$active ? p.theme.surface : "transparent")};
  cursor: pointer;
`;
const Filters = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  select {
    border: 1px solid ${(p) => p.theme.divider};
    border-radius: 6px;
    padding: 7px 9px;
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.background};
  }
`;
const TagBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
`;
const Tag = styled.button<{ $active?: boolean }>`
  border: 1px solid ${(p) => (p.$active ? p.theme.primary : p.theme.divider)};
  border-radius: 999px;
  padding: 3px 8px;
  color: ${(p) => (p.$active ? p.theme.primary : p.theme.textTertiary)};
  background: transparent;
  cursor: pointer;
  font-size: 12px;
`;
const Summary = styled.div`
  color: ${(p) => p.theme.textTertiary};
  font-size: 13px;
  margin-bottom: 8px;
`;
const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 14px;
  border: 1px solid ${(p) => p.theme.divider};
  border-radius: 8px;
  cursor: pointer;
  &:hover {
    background: ${(p) => p.theme.surface};
  }
`;
const Main = styled.div`
  min-width: 0;
  flex: 1;
`;
const Title = styled.div`
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const MetaLine = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  margin-top: 6px;
`;
const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  a {
    color: ${(p) => p.theme.textTertiary};
    font-size: 12px;
  }
`;
const LikeButton = styled.button<{ $active: boolean }>`
  border: 0;
  background: transparent;
  color: ${(p) => (p.$active ? p.theme.primary : p.theme.textTertiary)};
  cursor: pointer;
  font-size: 12px;
`;
const ScoreButton = styled.button<{ $active: boolean }>`
  border: 0;
  background: transparent;
  color: ${(p) => (p.$active ? p.theme.primary : p.theme.textTertiary)};
  cursor: pointer;
  font-size: 12px;
`;
const ReadButton = styled.button<{ $state: string }>`
  border: 1px solid
    ${(p) => (p.$state === "read" ? p.theme.success : p.theme.divider)};
  color: ${(p) => p.theme.text};
  background: transparent;
  border-radius: 999px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
`;
