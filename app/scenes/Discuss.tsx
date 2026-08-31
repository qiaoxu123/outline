import { CommentIcon } from "outline-icons";
import * as React from "react";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import Button from "~/components/Button";
import Empty from "~/components/Empty";
import InputSearch from "~/components/InputSearch";
import Scene from "~/components/Scene";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import { openInTab } from "~/utils/tabNavigation";
import {
  collectionDocuments,
  flattenDocuments,
  listCollections,
  type CustomDocument,
} from "./customData";

type Topic = CustomDocument & {
  parentDocumentId?: string | null;
  createdAt?: string;
  createdBy?: { name?: string };
};
const likeKey = "outline.desktop.discuss.likes.v1";

function readLikes(scope: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(`${likeKey}.${scope}`) ?? "{}");
  } catch {
    return {};
  }
}

export default function Discuss() {
  const { documents, tabs, auth } = useStores();
  const history = useHistory();
  const scope = auth.currentTeamId ?? window.location.host;
  const [topics, setTopics] = React.useState<Topic[]>([]);
  const [categories, setCategories] = React.useState<CustomDocument[]>([]);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [composing, setComposing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("");
  const [likes, setLikes] = React.useState(() => readLikes(scope));
  const [pins, setPins] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const collections = await listCollections();
      const forum = collections.find((item) =>
        ["论坛空间", "讨论区"].includes(item.name.trim()),
      );
      if (!forum) {
        setTopics([]);
        setCategories([]);
        return;
      }
      const tree = await collectionDocuments(forum.id);
      const cats = tree.filter((item) => (item.children?.length ?? 0) > 0);
      const categoryIds = new Set(cats.map((item) => item.id));
      setCategories(cats);
      setTopics(
        flattenDocuments(tree)
          .filter((item) => !categoryIds.has(item.id))
          .map((item) => item as Topic),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    let cancelled = false;
    client
      .post<{ data: { pins: { id: string; documentId: string }[] } }>(
        "/pins.list",
        { limit: 100 },
      )
      .then((response) => {
        if (!cancelled)
          setPins(
            Object.fromEntries(
              (response.data?.pins ?? []).map((pin) => [
                pin.documentId,
                pin.id,
              ]),
            ),
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [topics.length]);

  const createTopic = async () => {
    if (!title.trim()) return;
    try {
      const response = await client.post<{ data: Topic }>("/documents.create", {
        title: title.trim(),
        text: "",
        collectionId: (await listCollections()).find((item) =>
          ["论坛空间", "讨论区"].includes(item.name.trim()),
        )?.id,
        ...(selectedCategory ? { parentDocumentId: selectedCategory } : {}),
        publish: true,
      });
      setComposing(false);
      setTitle("");
      await load();
      if (response.data)
        openInTab(history, tabs, {
          id: response.data.id,
          url:
            documents.get(response.data.id)?.url ?? `/doc/${response.data.id}`,
          title: response.data.title ?? title.trim(),
        });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发帖失败");
    }
  };
  const toggleLike = (id: string) => {
    const next = { ...likes, [id]: !likes[id] };
    setLikes(next);
    localStorage.setItem(`${likeKey}.${scope}`, JSON.stringify(next));
  };
  const togglePin = async (id: string) => {
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
          { documentId: id },
        );
        setPins((current) => ({ ...current, [id]: response.data.id }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "置顶操作失败");
    }
  };
  const visible = topics
    .filter(
      (topic) =>
        (!category || topic.parentDocumentId === category) &&
        topic.title.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => Number(!!pins[b.id]) - Number(!!pins[a.id]));

  return (
    <Scene
      icon={<CommentIcon />}
      title="讨论区"
      textTitle="讨论区"
      wide
      actions={
        <Actions>
          <Button onClick={() => void load()} neutral>
            刷新
          </Button>
          <Button onClick={() => setComposing(true)}>发新帖</Button>
        </Actions>
      }
    >
      <FeatureHeader>
        <div>
          <FeatureTitle>讨论区</FeatureTitle>
          <Intro>
            主题即文档，回复使用官方评论；讨论区和知识库使用同一账号与导航。
          </Intro>
        </div>
        <FeatureStats>{topics.length ? `${topics.length} 个主题` : ""}</FeatureStats>
      </FeatureHeader>
      <Toolbar>
        <InputSearch
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索讨论主题…"
        />
        {composing && (
          <Composer>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void createTopic()}
              placeholder="帖子标题…"
            />
            <select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              <option value="">不分版块</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <Button onClick={() => void createTopic()} disabled={!title.trim()}>
              发布
            </Button>
            <Button onClick={() => setComposing(false)} neutral>
              取消
            </Button>
          </Composer>
        )}
      </Toolbar>
      {categories.length > 0 && (
        <CategoryBar>
          <Category $active={!category} onClick={() => setCategory(null)}>
            全部
          </Category>
          {categories.map((item) => (
            <Category
              key={item.id}
              $active={category === item.id}
              onClick={() => setCategory(category === item.id ? null : item.id)}
            >
              {item.title}
            </Category>
          ))}
        </CategoryBar>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {loading ? (
        <Empty>正在加载讨论主题…</Empty>
      ) : visible.length === 0 ? (
        <Empty>暂时没有匹配的讨论主题。</Empty>
      ) : (
        <List>
          {visible.map((topic) => (
            <Row
              key={topic.id}
              onClick={() =>
                openInTab(history, tabs, {
                  id: topic.id,
                  url: documents.get(topic.id)?.url ?? `/doc/${topic.id}`,
                  title: topic.title || "无标题",
                })
              }
            >
              <Avatar aria-hidden>
                {(topic.createdBy?.name ?? "成").slice(0, 1)}
              </Avatar>
              <TopicMain>
                <TopicTitle>{topic.title || "无标题"}</TopicTitle>
                <TopicMeta>
                  {topic.createdBy?.name ?? "成员"}
                  {topic.createdAt
                    ? ` · ${new Date(topic.createdAt).toLocaleDateString()}`
                    : ""}
                </TopicMeta>
              </TopicMain>
              <Like
                onClick={(event) => {
                  event.stopPropagation();
                  toggleLike(topic.id);
                }}
                $active={!!likes[topic.id]}
              >
                ♥ {likes[topic.id] ? "已赞" : "点赞"}
              </Like>
              <PinButton
                onClick={(event) => {
                  event.stopPropagation();
                  void togglePin(topic.id);
                }}
                $active={!!pins[topic.id]}
              >
                {pins[topic.id] ? "📌 已置顶" : "置顶"}
              </PinButton>
            </Row>
          ))}
        </List>
      )}
    </Scene>
  );
}

const Actions = styled.div`
  display: flex;
  gap: 8px;
`;
const FeatureHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 22px 0 16px;
`;
const FeatureTitle = styled.h2`
  margin: 0 0 4px;
  font-size: 24px;
  letter-spacing: -0.02em;
`;
const FeatureStats = styled.div`
  flex-shrink: 0;
  color: ${(props) => props.theme.textTertiary};
  font-size: 13px;
  padding-top: 6px;
`;
const Intro = styled.p`
  color: ${(p) => p.theme.textTertiary};
  margin: 0;
  font-size: 14px;
`;
const Toolbar = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  > *:first-child {
    flex: 1;
  }
`;
const Composer = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  input,
  select {
    border: 1px solid ${(p) => p.theme.divider};
    border-radius: 6px;
    padding: 8px;
    background: ${(p) => p.theme.background};
    color: ${(p) => p.theme.text};
  }
`;
const CategoryBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
`;
const Category = styled.button<{ $active: boolean }>`
  border: 1px solid ${(p) => (p.$active ? p.theme.primary : p.theme.divider)};
  border-radius: 999px;
  padding: 4px 9px;
  color: ${(p) => (p.$active ? p.theme.primary : p.theme.textTertiary)};
  background: transparent;
  cursor: pointer;
`;
const ErrorText = styled.p`
  color: ${(p) => p.theme.danger};
`;
const List = styled.div`
  display: flex;
  flex-direction: column;
`;
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 12px;
  border-bottom: 1px solid ${(p) => p.theme.divider};
  border-radius: 8px;
  cursor: pointer;
  &:hover {
    background: ${(p) => p.theme.surface};
  }
`;
const Avatar = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${(props) => props.theme.sidebarActiveBackground};
  color: ${(props) => props.theme.textSecondary};
  font-size: 13px;
  font-weight: 600;
`;
const TopicMain = styled.div`
  flex: 1;
  min-width: 0;
`;
const TopicTitle = styled.div`
  font-weight: 550;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const TopicMeta = styled.div`
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  margin-top: 5px;
`;
const Like = styled.button<{ $active: boolean }>`
  border: 0;
  background: transparent;
  color: ${(p) => (p.$active ? p.theme.primary : p.theme.textTertiary)};
  cursor: pointer;
  font-size: 12px;
`;
const PinButton = styled.button<{ $active: boolean }>`
  border: 0;
  background: transparent;
  color: ${(p) => (p.$active ? p.theme.primary : p.theme.textTertiary)};
  cursor: pointer;
  font-size: 12px;
`;
