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
