/** Run bounded background work while preserving input order and failures. */
export async function settleWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = Array.from<PromiseSettledResult<R>>({
    length: items.length,
  });
  let cursor = 0;
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(concurrency) || 1)
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = {
            status: "fulfilled",
            value: await mapper(items[index], index),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    })
  );

  return results;
}

/** Failed counters remain stale so the next background pass can retry them. */
export function fulfilledRefreshEntries(
  results: PromiseSettledResult<readonly [string, number]>[]
): (readonly [string, number])[] {
  return results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
}

/** Select the leading changed portion of an updatedAt-descending API page. */
export function selectChangedRefreshItems<
  T extends { updatedAt?: string; createdAt?: string },
>(
  items: T[],
  since: string,
  until?: string
): { changed: T[]; reachedCheckpoint: boolean } {
  const checkpoint = new Date(since).getTime();
  const upperBound = until
    ? new Date(until).getTime()
    : Number.POSITIVE_INFINITY;
  const changed: T[] = [];
  let reachedCheckpoint = false;
  for (const item of items) {
    const timestamp = item.updatedAt ?? item.createdAt;
    const updatedAt = timestamp ? new Date(timestamp).getTime() : Number.NaN;
    if (!Number.isNaN(updatedAt) && updatedAt > upperBound) {
      continue;
    }
    if (!Number.isNaN(updatedAt) && updatedAt <= checkpoint) {
      reachedCheckpoint = true;
      continue;
    }
    changed.push(item);
  }
  return { changed, reachedCheckpoint };
}

/**
 * Comment pages are sorted by createdAt, not updatedAt. Using updatedAt as
 * an incremental cursor would miss replies whenever an old comment is edited.
 * The caller periodically runs a complete reconciliation for edits/deletes.
 */
export function selectNewDiscussionComments<
  T extends { id?: string; createdAt?: string },
>(
  comments: T[],
  since: string,
  until: string
): { changed: T[]; reachedCheckpoint: boolean } {
  const checkpoint = new Date(since).getTime();
  const upperBound = new Date(until).getTime();
  const changed: T[] = [];
  let reachedCheckpoint = false;
  for (const comment of comments) {
    const createdAt = comment.createdAt
      ? new Date(comment.createdAt).getTime()
      : Number.NaN;
    if (!Number.isFinite(createdAt)) {
      // Unknown timestamps cannot be safely counted as new replies.
      // A later full reconciliation will include them.
      continue;
    }
    if (createdAt > upperBound) continue;
    if (createdAt <= checkpoint) {
      reachedCheckpoint = true;
      continue;
    }
    changed.push(comment);
  }
  return { changed, reachedCheckpoint };
}
