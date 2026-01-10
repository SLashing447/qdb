export type Schema = {
  [storeName: string]: {
    /**
     * Primary Keys are Necessary Field
     *
     * to identify objects in the db
     */
    pk: readonly string[] | string;
    /**
     * Index/Indices are Optional,
     * to make query get easier
     */
    index: readonly string[] | string;
    /**
     * Data is Necesasry Field
     * The Entire Schema of this Store including pk and index
     * and other fields
     *
     * Usage
     *
     * ```ts
     * interface Person {
     *  name:string;
     *  age:number;
     *  ...
     * }
     * // then in the data
     * data : {} as Person;
     * ```
     */
    data: Record<string, any>;
    /**
     * Optional data encoding
     * It is enabled by default
     */
    encoding?: boolean;
    /**
     * Applies to Primary Key
     * Optional Auto Increment simple non Compound Primary keys
     */
    autoInc?: boolean;
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
