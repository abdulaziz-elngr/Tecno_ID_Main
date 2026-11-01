/**
 * Tiny in-process TTL cache for data that is read on EVERY request but changes
 * rarely (the session row, the user's role/permission tree, org settings, the
 * center time zone). On a hot path such as the attendance scanner each of these
 * used to be one extra database round trip per scan.
 *
 * It is per server instance (fine for a single Node process and still useful on
 * serverless: warm instances reuse it). Always keep the TTL short and call
 * `delete`/`clear` from the code that changes the underlying data.
 */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): V {
    if (this.store.size >= this.maxEntries) {
      // Drop the oldest entry (Map keeps insertion order).
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Returns the cached value or loads (and caches) it. Failures are never cached. */
  async wrap(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    return this.set(key, await load());
  }
}
