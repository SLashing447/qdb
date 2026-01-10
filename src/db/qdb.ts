import { Engine } from "./engine.js";
import { Query, UpdateQuery, RemoveQuery } from "./query.js";

import type {
  Codec,
  EventActions,
  EventName,
  Schema,
  StoreData,
} from "./types.js";

export default class qdb<S extends Schema, Wire> {
  private engine: Engine<S, Wire>;
  private events: EventTarget; // Private EventTarget

  constructor(
    dbName: string,
    version: number,
    schema: S,
    codec: Codec<Wire>,
    cache_limit: number = 1000
  ) {
    this.events = new EventTarget();
    this.engine = new Engine(dbName, version, schema, codec, cache_limit);
  }

  /**
   * Open the db (Must)
   */
  async open(): Promise<this> {
    await this.engine.open();
    return this;
  }

  /**
   * put data into db
   */
  async put<K extends keyof S>(
    storeName: K,
    data: StoreData<S, K>
  ): Promise<void> {
    await this.engine.put(storeName, data);

    this.emit(storeName, "ADD", data);
  }

  /**
   * fetch Record by query callbacks
   *
   * end with `all()` or `one()`
   */
  query<store extends keyof S & string>(storeName: store): Query<S, store> {
    return new Query(this.engine, storeName);
  }

  /**
   * update Record by query callbacks
   *
   * end with `exec()`
   */
  update<store extends keyof S & string>(
    storeName: store,
    updates: Partial<StoreData<S, store>>
  ): UpdateQuery<S, store> {
    const query = new UpdateQuery(this.engine, storeName, updates);

    // Wrap exec method
    const originalExec = query.exec.bind(query);
    query.exec = async () => {
      const count = await originalExec();

      // Emit UPT event after successful update
      this.emit(storeName, "UP", updates);

      return count;
    };

    return query;
  }

  /**
   * update Record by query callbacks
   *
   * end with `exec()`
   */
  remove<K extends keyof S & string>(storeName: K): RemoveQuery<S, K> {
    // let name = storeName
    const query: RemoveQuery<S, K> = new RemoveQuery(this.engine, storeName);

    // Wrap exec method
    const originalExec = query.exec.bind(query);
    query.exec = async () => {
      const keys = await originalExec();

      // Emit DEL event after successful delete
      this.emit(storeName, "RM", keys);

      return keys;
    };

    return query;
  }

  /**
   * close db as clean up measure
   */
  close(): void {
    this.engine.close();
  }

  /**
   * static method to delete indexed-db
   */
  static async deleteDatabase(dbName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * setup event and fire across application
   * @param store - Store name extends  `const stores`
   * @param action - "ADD" | "DEL" | "UPT" : type of event
   * @param data - `StoreData[K]` to deliver
   */
  private emit<store extends keyof S>(
    store: store,
    action: "UP",
    data: Partial<StoreData<S, store>>
  ): void;
  private emit<store extends keyof S>(
    store: store,
    action: "ADD",
    data: StoreData<S, store>
  ): void;
  private emit<store extends keyof S>(
    store: store,
    action: "RM",
    data: IDBValidKey[]
  ): void;

  private emit<store extends keyof S & string>(
    store: store,
    action: EventActions,
    data: Partial<StoreData<S, store>> | StoreData<S, store> | IDBValidKey[]
  ): void {
    const event = {
      data,
      name: `${store}-${action}`,
    };

    this.events.dispatchEvent(
      new CustomEvent(event.name, {
        detail: event.data,
        bubbles: true,
        cancelable: true,
      })
    );
  }
  /**
   * Subscribe to STORE-specific events.
   *
   * @param event - Event name derived from the store:
   * `{store}-UP` | `{store}-ADD` | `{store}-RM`
   *
   * @param listener - Callback invoked with event payload:
   * - `{store}-UP`  → Partial<Record>
   * - `{store}-ADD` → Record
   * - `{store}-RM`  → Keys[]
   *
   * @returns Cleanup function to unsubscribe.
   */
  subscribe<store extends keyof S & string>(
    event: `${store}-UP`,
    listener: (data: Partial<StoreData<S, store>>) => void
  ): () => void;
  subscribe<store extends keyof S & string>(
    event: `${store}-ADD`,
    listener: (data: StoreData<S, store>) => void
  ): () => void;
  subscribe<store extends keyof S & string>(
    event: `${store}-RM`,
    listener: (data: IDBValidKey[]) => void
  ): () => void;

  subscribe<store extends keyof S & string>(
    event: EventName<store>,
    listener: (data: any) => void
  ): () => void {
    // wrap the listener to extract custom payload
    const wrapped: EventListener = (e) => {
      const customEvent = e as CustomEvent;
      // console.log(`listener.fired @${event}`);
      listener(customEvent.detail);
    };

    this.events.addEventListener(event, wrapped);

    return () => {
      this.events.removeEventListener(event, wrapped);
    };
  }
}
