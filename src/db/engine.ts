import { LRUCache } from "./lru.js";
import type { CacheKey, Codec, Schema, WhereClause } from "./types.js";

const toArray = (v: readonly string[] | string) =>
  typeof v === "string" ? [v] : v;

export class Engine<S extends Schema, Wire> {
  private db: IDBDatabase | null = null;
  private cache: LRUCache<CacheKey<S>, any>;

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
            let keyPath = Array.isArray(config.pk)
              ? config.pk.length === 1
                ? config.pk[0]
                : (config.pk as string[])
              : config.pk;

            if (!keyPath) {
              throw new Error(
                `[quteDB]: Primary Key for the Store "${storeName}"  , Is Not defined`
              );
            }

            let ainc: boolean = Array.isArray(config.pk)
              ? config.pk.length === 1 && config.pk[0].startsWith("++")
              : typeof config.pk === "string" && config.pk.startsWith("++");

            if (ainc) {
              keyPath = this.schema[storeName]?.pk.slice(2);
              this.schema[storeName]!.pk = keyPath;
            }

            const store = db.createObjectStore(storeName, {
              keyPath,
              autoIncrement: ainc,
            });

            toArray(config.index).forEach((raw, i) => {
              const unique = raw.startsWith("--");
              const index = unique ? raw.slice(2) : raw;

              const schemaIndex = this.schema[storeName]?.index;
              if (unique) {
                if (Array.isArray(schemaIndex)) schemaIndex[i] = index;
                else this.schema[storeName]!.index = index;
              }

              store.createIndex(index, index, { unique });
            });
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
        throw new Error("[quteDB]: The Store Schema is Not Defined/Corrupted");
      }

      if (config.encoding === false) return data;

      const indexedFields: string[] = [
        ...(Array.isArray(config.pk) ? config.pk : [config.pk]),
        ...(Array.isArray(config.index) ? config.index : [config.index]),
      ];

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

      const indexedFields: string[] = [
        ...(Array.isArray(config.pk) ? config.pk : [config.pk]),
        ...(Array.isArray(config.index) ? config.index : [config.index]),
      ];

      const indexed: any = {};

      // Extract indexed fields
      for (const field of indexedFields) {
        indexed[field] = data[field];
      }

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

    // console.log("Storagedata : ", storageData, "\nusdata :  ", userData);

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
      const v = this.cache.get([storeName, k]);
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

                  this.cache.set([storeName, k], res);
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
    // PK metadata
    // ─────────────────────────────────────────────
    const pkPath = Array.isArray(store.keyPath)
      ? store.keyPath
      : typeof store.keyPath === "string"
      ? [store.keyPath]
      : null;

    const isPKField = (f: string) => pkPath?.includes(f) ?? false;

    // ─────────────────────────────────────────────
    // ORDER BY source
    // ─────────────────────────────────────────────
    let orderingSource: IDBObjectStore | IDBIndex = store;

    if (orderField) {
      const isPK = isPKField(orderField);
      const isIndex = store.indexNames.contains(orderField);

      if (!isPK && !isIndex) {
        throw new Error(
          `[quteDB]: ORDER BY field "${orderField}" is not indexed`
        );
      }

      // composite PK ordering only allowed on first field
      if (isPK && pkPath!.length > 1 && pkPath![0] !== orderField) {
        throw new Error(
          `[quteDB]: ORDER BY "${orderField}" must be first field of composite PK`
        );
      }

      orderingSource = isPK ? store : store.index(orderField);
    }

    // ─────────────────────────────────────────────
    // WHERE planning
    // ─────────────────────────────────────────────
    const pkWheres: WhereClause[] = [];
    const indexWheres: WhereClause[] = [];

    for (const w of wheres) {
      if (isPKField(w.field)) {
        pkWheres.push(w);
      } else {
        indexWheres.push(w);
      }
    }

    const filterSets: Set<IDBValidKey>[] = [];

    // ─────────────────────────────────────────────
    // PK scan (single OR composite)
    // ─────────────────────────────────────────────
    if (pkPath && pkWheres.length > 0) {
      const isCompositePK = pkPath.length > 1;
      const range = buildCompositePKRange(pkPath, pkWheres, isCompositePK);
      if (range) {
        const keys = await scanKeys(store, range);
        filterSets.push(new Set(keys));
      }
    }

    // ─────────────────────────────────────────────
    // Index scans
    // ─────────────────────────────────────────────
    for (const w of indexWheres) {
      if (w.field === orderField) continue;

      const isIndex = store.indexNames.contains(w.field);

      if (!isIndex) {
        throw new Error(`[quteDB]: Field ${w.field} not indexed`);
      }

      const source = store.index(w.field);

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
    // Walk ordering cursor + intersect
    // ─────────────────────────────────────────────
    const results: IDBValidKey[] = [];
    let skipped = 0;

    // Helper to normalize keys for comparison
    // For composite keys with primitives only
    const normalizeKey = (key: IDBValidKey): string => {
      if (Array.isArray(key)) {
        return key.join("\x00"); // Use null byte separator
      }
      return String(key);
    };

    // Convert filterSets to use serialized keys
    const normalizedFilterSets = filterSets.map(
      (set) => new Set(Array.from(set).map(normalizeKey))
    );

    console.log(normalizedFilterSets);

    return new Promise((resolve, reject) => {
      const req = orderingSource.openKeyCursor(null, direction);

      req.onsuccess = () => {
        const cursor = req.result as IDBCursor | null;
        if (!cursor) return resolve(results);

        const pk =
          cursor.primaryKey !== undefined ? cursor.primaryKey : cursor.key;
        const normalizedPK = normalizeKey(pk);

        // Check against normalized sets
        for (const set of normalizedFilterSets) {
          if (!set.has(normalizedPK)) {
            cursor.continue();
            return;
          }
        }

        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }

        results.push(pk);

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

    // console.log("scanKeys - source:", source.name);
    // console.log("scanKeys - range:", range);

    req.onsuccess = () => {
      const c = req.result as IDBCursor | null;

      // console.log("scanKeys - cursor:", c);
      // console.log("scanKeys - cursor.key:", c?.key);
      // console.log("scanKeys - cursor.primaryKey:", c?.primaryKey);

      if (!c) {
        // console.log("scanKeys - DONE, found keys:", keys);
        return resolve(keys);
      }

      const pk = c.primaryKey !== undefined ? c.primaryKey : c.key;
      keys.push(pk);
      c.continue();
    };

    req.onerror = () => {
      // console.log("scanKeys - ERROR:", req.error);
      reject(req.error);
    };
  });
}

function buildCompositePKRange(
  pkPath: string[],
  wheres: WhereClause[],
  isCompositePK: boolean
): IDBKeyRange | null {
  if (wheres.length === 0) return null;

  const fieldToWhere = new Map(wheres.map((w) => [w.field, w]));

  const prefix: any[] = [];
  let rangeOp: { op: WhereClause["op"]; value: any } | null = null;

  for (let i = 0; i < pkPath.length; i++) {
    const field = pkPath[i];
    if (!field) continue;

    const w = fieldToWhere.get(field);

    if (!w) {
      break;
    }

    if (w.op === "==") {
      prefix.push(w.value);
    } else {
      const pkPathAtiP1 = pkPath[i + 1];
      if (typeof pkPathAtiP1 === "string") {
        if (i < pkPath.length - 1 && fieldToWhere.has(pkPathAtiP1)) {
          throw new Error(
            `[quteDB]: Composite PK range query on "${field}" cannot have conditions on later components`
          );
        }
      }
      rangeOp = { op: w.op, value: w.value };
      break;
    }
  }

  if (isCompositePK) {
    for (let i = 0; i < pkPath.length; i++) {
      const pkPathAti = pkPath[i];
      if (pkPathAti) {
        const hasWhere = fieldToWhere.has(pkPathAti);
        const prefixEnded = i >= prefix.length && !rangeOp;

        if (hasWhere && prefixEnded) {
          throw new Error(
            `[quteDB]: Composite PK WHERE clauses must be contiguous. Cannot query "${
              pkPath[i]
            }" without "${pkPath[i - 1]}"`
          );
        }
      }
    }
  }

  if (prefix.length === 0 && !rangeOp) return null;

  // console.log("DEBUG prefix:", prefix);
  // console.log("DEBUG rangeOp:", rangeOp);
  // console.log("DEBUG isCompositePK:", isCompositePK);
  // console.log("DEBUG pkPath.length:", pkPath.length);
  // console.log("DEBUG prefix.length:", prefix.length);

  if (rangeOp) {
    const { op, value } = rangeOp;

    if (isCompositePK) {
      if (op === ">") {
        return IDBKeyRange.bound(
          [...prefix, value, []],
          [...prefix, []],
          false,
          false
        );
      } else if (op === ">=") {
        return IDBKeyRange.bound(
          [...prefix, value],
          [...prefix, []],
          false,
          false
        );
      } else if (op === "<") {
        return IDBKeyRange.bound(
          prefix.length > 0 ? prefix : [],
          [...prefix, value],
          false,
          true
        );
      } else if (op === "<=") {
        return IDBKeyRange.bound(
          prefix.length > 0 ? prefix : [],
          [...prefix, value, []],
          false,
          false
        );
      }
    } else {
      if (op === ">") {
        return IDBKeyRange.lowerBound(value, true);
      } else if (op === ">=") {
        return IDBKeyRange.lowerBound(value, false);
      } else if (op === "<") {
        return IDBKeyRange.upperBound(value, true);
      } else if (op === "<=") {
        return IDBKeyRange.upperBound(value, false);
      }
    }
  }

  // Pure equality
  if (isCompositePK) {
    const hasAllComponents = prefix.length === pkPath.length;

    // console.log("DEBUG hasAllComponents:", hasAllComponents);

    if (hasAllComponents) {
      // console.log("DEBUG: Creating IDBKeyRange.only() for:", prefix);
      return IDBKeyRange.only(prefix);
    } else {
      // console.log("DEBUG: Creating prefix bound for:", prefix);
      return IDBKeyRange.bound(prefix, [...prefix, []], false, false);
    }
  } else {
    return IDBKeyRange.only(prefix[0]);
  }
}
