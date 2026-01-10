import { LRUCache } from "./lru.js";
import type { Codec, Schema, WhereClause } from "./types.js";

export class Engine<S extends Schema, Wire> {
  private db: IDBDatabase | null = null;
  private cache: LRUCache<IDBValidKey, any>;

  constructor(
    private dbName: string,
    private version: number,
    private schema: S,
    private codec: Codec<Wire>,
    private cache_limit: number = 1000
  ) {
    this.cache = new LRUCache(this.cache_limit);
  }

  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        console.log(
          `%c[quteDB]: %cDatabase opened ${this.dbName} v${this.version}`,
          "color: lightgreen; font-weight: bold;",
          "font-style:italic;color:lightgrey"
        );

        for (const storeName of Object.keys(this.schema)) {
          if (!this.db.objectStoreNames.contains(storeName)) {
            reject(new Error(`[quteDB]: Store "${storeName}" not found`));
            return;
          }
        }

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        for (const [storeName, config] of Object.entries(this.schema)) {
          if (!db.objectStoreNames.contains(storeName)) {
            const keyPath = Array.isArray(config.pk)
              ? config.pk.length === 1
                ? config.pk[0]
                : (config.pk as string[])
              : config.pk;

            if (!keyPath) {
              throw new Error(
                `[quteDB]: Primary Key for the Store "${storeName}"  , Is Not defined`
              );
            }

            let autoIncrement = config.autoInc ?? false;

            if (autoIncrement === true && Array.isArray(keyPath)) {
              console.log(keyPath);
              throw new Error(
                `[quteDB]: cannot have autoincrement for composite primary key`
              );
            }

            const store = db.createObjectStore(storeName, {
              keyPath,
              autoIncrement,
            });

            const indexes =
              typeof config.index === "string" ? [config.index] : config.index;

            for (const indexField of indexes) {
              store.createIndex(indexField, indexField, { unique: false });
            }
          }
        }
      };
    });
  }

  private normalizeUint8Arrays(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (obj instanceof Uint8Array) {
      return obj;
    }

    if (
      obj.constructor?.name === "Buffer" ||
      (obj.buffer && obj.byteLength !== undefined)
    ) {
      return new Uint8Array(obj);
    }

    if (typeof obj === "object" && !Array.isArray(obj)) {
      const normalized: any = {};
      for (const key in obj) {
        normalized[key] = this.normalizeUint8Arrays(obj[key]);
      }
      return normalized;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.normalizeUint8Arrays(item));
    }

    return obj;
  }

  encode<K extends keyof S>(storeName: K, data: any): any {
    try {
      const config = this.schema[storeName];
      if (!config) {
        throw new Error(
          `[quteDB]: The Store "${
            storeName as string
          }" Schema is Not Defined/Corrupted`
        );
      }
      if (config.encoding === false) return data;

      const indexedFields = [...new Set([...config.pk, ...config.index])];

      const indexed: any = {};
      const dataObj: any = {};

      // Iterate over actual userData fields, not schema
      for (const field in data) {
        if (indexedFields.includes(field)) {
          // Indexed field - store directly
          indexed[field] = data[field];
        } else {
          // Non-indexed field - goes into data blob
          dataObj[field] = data[field];
        }
      }

      // console.log("dataObj:", dataObj); // Should have data now

      const encoded = this.codec.encode(dataObj);

      return {
        ...indexed,
        data: encoded,
      };
    } catch (e) {
      throw new Error(`[quteDB]: toStorage Error : ${e}`);
    }
  }

  decode<K extends keyof S>(storeName: K, data: any): any {
    try {
      const config = this.schema[storeName];
      if (!config) {
        throw new Error("[quteDB]: The Store Schema is Not Defined/Corrupted");
      }
      if (config.encoding === false) return data;

      const indexedFields = [...new Set([...config.pk, ...config.index])];

      const indexed: any = {};

      // Extract indexed fields
      for (const field of indexedFields) {
        indexed[field] = data[field];
      }

      // Decode data blob

      const decoded = this.codec.decode(data.data);
      const normalized = this.normalizeUint8Arrays(decoded);

      return { ...indexed, ...normalized };
    } catch (e) {
      throw new Error(`[quteDB]: fromStorage Error : ${e}`);
    }
  }

  async put<K extends keyof S>(storeName: K, userData: any): Promise<void> {
    if (!this.db) throw new Error("[quteDB]: Database not opened");

    const storageData = this.encode(storeName, userData);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName as string, "readwrite");
      const store = tx.objectStore(storeName as string);
      const request = store.put(storageData);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete<K extends keyof S>(storeName: K, key: any): Promise<void> {
    if (!this.db) throw new Error("[quteDB]: Database not opened");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName as string, "readwrite");
      const store = tx.objectStore(storeName as string);
      const request = store.delete(key);

      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  getSchema<K extends keyof S>(storeName: K): S[K] {
    return this.schema[storeName];
  }

  async getRecordsByKeys<K extends keyof S>(
    storeName: K,
    keys: IDBValidKey[]
  ): Promise<Record<K, S>[]> {
    const results = new Map<IDBValidKey, any>();
    const misses: IDBValidKey[] = [];

    for (const k of keys) {
      const v = this.cache.get(k);
      if (v !== undefined) results.set(k, v);
      else misses.push(k);
    }

    if (misses.length) {
      const tx = this.db!.transaction(storeName as string, "readonly");
      const store = tx.objectStore(storeName as string);

      await Promise.all(
        misses.map(
          (k) =>
            new Promise<void>((resolve, reject) => {
              const r = store.get(k);
              r.onsuccess = () => {
                if (r.result !== undefined) {
                  let res = this.decode(storeName, r.result);

                  this.cache.set(k, res);
                  results.set(k, res);
                }
                resolve();
              };
              r.onerror = () => reject(r.error);
            })
        )
      );
    }

    return keys.map((k) => results.get(k)).filter(Boolean);
  }

  async getKeysByIndexes<K extends keyof S>(
    storeName: K,
    wheres: WhereClause[],
    orderField?: string,
    orderDir: "asc" | "desc" = "asc",
    limit?: number,
    offset = 0
  ): Promise<IDBValidKey[]> {
    if (!this.db) throw new Error("[quteDB]: DB not opened");

    const tx = this.db.transaction(storeName as string, "readonly");
    const store = tx.objectStore(storeName as string);

    const direction: IDBCursorDirection = orderDir === "desc" ? "prev" : "next";

    // ─────────────────────────────────────────────
    // 1. Decide ordering source (PK or index)
    // ─────────────────────────────────────────────
    let orderingSource: IDBObjectStore | IDBIndex = store;

    if (orderField) {
      const isPK = store.keyPath === orderField;
      const isIndex = store.indexNames.contains(orderField);

      if (!isPK && !isIndex) {
        throw new Error(
          `[quteDB]: ORDER BY field "${orderField}" is not indexed`
        );
      }

      orderingSource = isPK ? store : store.index(orderField);
    }

    // ─────────────────────────────────────────────
    // 2. Build sets for non-ordering WHERE clauses
    // ─────────────────────────────────────────────
    const filterSets: Set<IDBValidKey>[] = [];

    for (const w of wheres) {
      // skip where that matches ordering field (handled by cursor)
      if (w.field === orderField) continue;

      const isPK = store.keyPath === w.field;
      const isIndex = store.indexNames.contains(w.field);

      if (!isPK && !isIndex) {
        throw new Error(`[quteDB]: Field ${w.field} not indexed`);
      }

      const source = isPK ? store : store.index(w.field);
      const range =
        w.op === "=="
          ? IDBKeyRange.only(w.value)
          : w.op === ">"
          ? IDBKeyRange.lowerBound(w.value, true)
          : w.op === ">="
          ? IDBKeyRange.lowerBound(w.value)
          : w.op === "<"
          ? IDBKeyRange.upperBound(w.value, true)
          : IDBKeyRange.upperBound(w.value);

      const keys = await scanKeys(source, range);
      filterSets.push(new Set(keys));
    }

    // ─────────────────────────────────────────────
    // 3. Walk ordering cursor + apply intersection
    //    + offset + limit INSIDE cursor
    // ─────────────────────────────────────────────
    const results: IDBValidKey[] = [];
    let skipped = 0;

    return new Promise((resolve, reject) => {
      const req = orderingSource.openKeyCursor(null, direction);

      req.onsuccess = () => {
        const cursor = req.result as IDBCursor | null;
        if (!cursor) {
          resolve(results);
          return;
        }

        const pk =
          cursor.primaryKey !== undefined ? cursor.primaryKey : cursor.key;

        // AND semantics: must exist in all filter sets
        for (const set of filterSets) {
          if (!set.has(pk)) {
            cursor.continue();
            return;
          }
        }

        // offset
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }

        results.push(pk);

        // limit
        if (limit !== undefined && results.length >= limit) {
          resolve(results);
          return;
        }

        cursor.continue();
      };

      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  close(): void {
    this.db?.close();
  }
}
async function scanKeys(
  source: IDBObjectStore | IDBIndex,
  range: IDBKeyRange | null
): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const keys: IDBValidKey[] = [];
    const req = source.openKeyCursor(range);

    req.onsuccess = () => {
      const c = req.result as IDBCursor | null;
      if (!c) return resolve(keys);

      const pk = c.primaryKey !== undefined ? c.primaryKey : c.key;

      keys.push(pk);
      c.continue();
    };

    req.onerror = () => reject(req.error);
  });
}
