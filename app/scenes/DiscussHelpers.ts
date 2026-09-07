export type TopicLike = {
  id: string;
  title: string;
  parentDocumentId?: string | null;
};

export type TopicListOptions = {
  category: string | null;
  query: string;
};

export function visibleTopics<T extends TopicLike>(
  topics: T[],
  pins: Record<string, string>,
  options: TopicListOptions
): T[] {
  const query = options.query.trim().toLowerCase();

  return topics
    .filter((topic) => {
      if (options.category && topic.parentDocumentId !== options.category) {
        return false;
      }
      return !query || topic.title.toLowerCase().includes(query);
    })
    .sort((a, b) => Number(!!pins[b.id]) - Number(!!pins[a.id]));
}
