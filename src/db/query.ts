import type { Engine } from "./engine.js";
import type { StoreData, WhereClause } from "./types.js";

// Shared filter builder
class QueryBuilder<S, K extends keyof S> {
  protected _where: WhereClause[] = [];
  protected limitVal?: number;
  protected offsetVal?: number;
  protected orderField?: string;
  protected orderDir?: "asc" | "desc";
  protected keysOnly = false;

  constructor(
    protected engine: Engine<any, any>,
    protected storeName: K & string
  ) {}

  /**
   * Query by indexed fields and primary keys
   */
  where(field: string, op: "==" | ">" | ">=" | "<" | "<=", value: any): this {
    this._where.push({ field, op, value });
    return this;
  }

  /**
   * limits the result
   */
  limit(n: number): this {
    this.limitVal = n;
    return this;
  }

  /**
   * start ur results from a given index
   */
  offset(n: number): this {
    this.offsetVal = n;
    return this;
  }

  /**
   * ascending order by index
   */
  asc(field?: string): this {
    const schema = this.engine.getSchema(this.storeName);
    this.orderField = field || schema.pk[0];
    this.orderDir = "asc";
    return this;
  }

  /**
   * descending order by index
   */
  desc(field?: string): this {
    const schema = this.engine.getSchema(this.storeName);
    this.orderField = field || schema.pk[0];
    this.orderDir = "desc";
    return this;
  }

  protected async executeQuery(): Promise<any[]> {
    // 1. ask engine for keys
    const keys = await this.engine.getKeysByIndexes(
      this.storeName,
      this._where,
      this.orderField,
      this.orderDir,
      this.limitVal,
      this.offsetVal
    );

    // console.log("pk are : ", keys);

    if (this.keysOnly) {
      return keys;
    }

    // 2. hydrate via cache + db
    return this.engine.getRecordsByKeys(this.storeName, keys);
  }
}

// Query for reads
export class Query<S, K extends keyof S> extends QueryBuilder<S, K> {
  async all(): Promise<StoreData<S, K>[]> {
    return this.executeQuery();
  }

  async one(): Promise<StoreData<S, K> | undefined> {
    this.limitVal = 1;
    const results = await this.executeQuery();
    return results[0];
  }

  nextPage(): this {
    this.offsetVal = (this.offsetVal || 0) + (this.limitVal || 0);
    return this;
  }

  /**
   * Ergonomic primary keys function runs that with query plan
   * @returns `IDBValidKey[]`
   */
  async keys(): Promise<IDBValidKey[]> {
    this.keysOnly = true;
    return this.executeQuery();
  }
}

// Update Query
export class UpdateQuery<S, K extends keyof S> extends QueryBuilder<S, K> {
  constructor(
    engine: Engine<any, any>,
    storeName: K & string,
    private updates: Partial<StoreData<S, K>>
  ) {
    super(engine, storeName);
  }

  async preview(): Promise<StoreData<S, K>[]> {
    return this.executeQuery();
  }

  async exec(): Promise<number> {
    const results = await this.executeQuery();

    for (const record of results) {
      const updated = Object.assign({}, record, this.updates);
      await this.engine.put(this.storeName, updated);
    }

    return results.length;
  }
}

// Remove Query
export class RemoveQuery<S, K extends keyof S> extends QueryBuilder<S, K> {
  async preview(): Promise<StoreData<S, K>[]> {
    return this.executeQuery();
  }

  async exec(): Promise<IDBValidKey[]> {
    this.keysOnly = true; // we want just the keys
    const keys = await this.executeQuery();
    const deletedKeys: IDBValidKey[] = [];

    for (const key of keys) {
      await this.engine.delete(this.storeName, key);
      deletedKeys.push(key); // Collect keys
    }

    return deletedKeys; // Return keys instead of count
  }
}
