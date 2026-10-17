/** Share a refresh across route mounts; every caller receives its completion. */
export function createSharedRefresh<T>() {
  const pending = new Map<string, Promise<T>>();
  return (scope: string, load: () => Promise<T>): Promise<T> => {
    const existing = pending.get(scope);
    if (existing) {
      return existing;
    }
    const request = Promise.resolve().then(load);
    pending.set(scope, request);
    const clear = () => {
      if (pending.get(scope) === request) {
        pending.delete(scope);
      }
    };
    void request.then(clear, clear);
    return request;
  };
}

/** Cache successful reads briefly and merge concurrent requests by workspace. */
export function createWorkspaceReadCache<T>(ttl: number) {
  const refresh = createSharedRefresh<T>();
  const values = new Map<string, { value: T; savedAt: number }>();
  return (key: string, load: () => Promise<T>, force = false): Promise<T> => {
    const cached = values.get(key);
    if (!force && cached && Date.now() - cached.savedAt < ttl) {
      return Promise.resolve(cached.value);
    }
    return refresh(key, async () => {
      const value = await load();
      values.set(key, { value, savedAt: Date.now() });
      // Limit process-lifetime memory across many workspaces/collections.
      if (values.size > 100) {
        const oldest = values.keys().next().value;
        if (oldest !== undefined) {
          values.delete(oldest);
        }
      }
      return value;
    });
  };
}

const writeQueues = new Map<string, Promise<void>>();

/** Serialize read-modify-write operations on a shared WebDAV file. */
export function enqueueWorkspaceWrite(
  key: string,
  write: () => Promise<void>
): Promise<void> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  writeQueues.set(key, next);
  const clear = () => {
    if (writeQueues.get(key) === next) {
      writeQueues.delete(key);
    }
  };
  void next.then(clear, clear);
  return next;
}

type WebdavReadResult = {
  ok?: boolean;
  data?: { found?: boolean; content?: string | null; etag?: string | null };
  error?: { code?: string; message?: string };
};

type WebdavWriteResult = {
  ok?: boolean;
  error?: { code?: string; message?: string };
};

/**
 * Optimistic concurrency across desktops sharing a WebDAV JSON file.
 * A 412 precondition failure means another client has already updated it;
 * re-read and re-apply the user's mutation to that latest document.
 *
 * Servers not returning ETag cannot guarantee concurrency safety for
 * existing files. Newly created files are still protected with If-None-Match.
 */
export async function updateSharedWebdavJson<T>(
  bridge: {
    webdavGet: (path: string) => Promise<unknown>;
    webdavPut: (
      path: string, content: string, expectedEtag?: string | null
    ) => Promise<unknown>;
  },
  path: string,
  parse: (content: string | undefined) => T,
  mutate: (current: T) => T,
  maxAttempts = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const read = await bridge.webdavGet(path) as WebdavReadResult;
    if (!read?.ok) {
      throw new Error(read?.error?.message ?? "无法读取共享数据");
    }
    const found = !!read.data?.found;
    const current = parse(found ? read.data?.content ?? undefined : undefined);
    const next = mutate(current);
    const etag = found ? read.data?.etag ?? undefined : null;
    const written = await bridge.webdavPut(
      path, JSON.stringify(next, null, 2), etag
    ) as WebdavWriteResult;
    if (written?.ok) return next;
    if (written?.error?.code === "CONFLICT" && attempt + 1 < maxAttempts) {
      continue;
    }
    throw new Error(
      written?.error?.message ?? "共享数据写入失败，请刷新后重试"
    );
  }
  throw new Error("共享数据多次发生冲突，请稍后重试");
}
