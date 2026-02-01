export type Schema = {
  [storeName: string]: {
    pk: readonly string[] | string;
    index: readonly string[] | string;
    data: Record<string, any>;
    /**
     * Optional data encoding , undefined=true by default
     */
    encoding?: boolean;
    // autoInc?: boolean;
  };
};

export interface Codec<Wire> {
  encode(data: unknown): Wire;
  decode(data: Wire): unknown;
}

export type StoreData<S, K extends keyof S> = S[K] extends { data: infer D }
  ? D
  : never;

export type EventActions = "ADD" | "UP" | "RM";
export type EventName<K extends keyof Schema & string> = `${K}-${EventActions}`;

export type WhereClause = {
  field: string;
  op: "==" | ">" | ">=" | "<" | "<=";
  value: any;
};

export type CacheKey<Schema, K extends keyof Schema = keyof Schema> = [
  storeName: K,
  key: IDBValidKey
];
