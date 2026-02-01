# QuteDb 🙈

### Very Simple and thin and Ergonomic IDB wrapper

- Make ur life easier duh and its super thin
- 0 extra dependencies
- it just works predictable and explicit

Some Stats:
| N | Cold | Hot |
| ---- | ------ | ------- |
| 50k | ~2.3 s | ~0.38 s |
| 100k | ~6.6 s | ~0.88 s |

## Install Using npm

```
npm install qdb
```

## Storage

Indexes and primary keys are stored plaintext and any fields that are not index is serialized/deserialized using a user given custom encode/decode function

```ts
interface Codec<Wire> {
  encode(data: unknown): Wire;
  decode(data: Wire): unknown;
}
```

## Query Logic

Query is done either by primary key (composite or simple) or index (unique or not). On Query by Index, the primary keys of the matching records are built using `openKeyCursor()` method. And Then records are fetched by their primary Keys.  
Composite Primary Keys uses Lexicographic search that is Left to Right query order. The difffernet order of operation can easily be applied like `==` , `>`,`>=`,`<=` on the queries by composite PK.  
**Note : Using Composite primary keys to query is like 10-15% faster than using unique indices, doesnot mean u should resort to using composite PKs always**

## LRU

It uses simple Lru class to maintain cache , 5th arguement of the qdb constructor takes the amount of records that can be stored in its runtime. no dynamic sizing yet , so it according to ur requiement.

## Usage

### Declare Your Database

```ts
// YourDatabase.ts
import qdb from "qdb";

interface Employee {
  name: string;
  id: string;
  age: number;
  joined: number;
  salary: number;
  addr: string;
  office: string;
}

const schema = {
  Employees: {
    pk: ["name","++id"], // "++" ensures id increments
    index:["age","--office"], // "--" ensures office is unqiue
    data: {} as Employee & {
        // u can add extra fields not in ur interface
        years:number;
    },
    encoding:false, // encoding is true by default

  },
} as const;


const mydb = await new qdb(
  "my-db", // db name
  1, // db version
  scehma, // db schema
  {
    decode: JSON.parse, // decode function of ur choice
    encode: JSON.stringify, // encode function of ur choice
  },
  2000 // cache records limit (this is crucial)
).open();

export mydb;
```

### 1. Put

```ts
await mydb.put("Employees", {
  name: "Alice",
  id: "e-1",
  age: 28,
  joined: Date.now(),
  salary: 90000,
  addr: "NY",
  office: "HQ",
  years: 3,
});
```

### 2. Query Functions

supported operations
`==  >  >=  <  <=`  
the `where` clause can only be used with
primary keys (composite or simple) and indexes  
Primay Keys uses Lexicographic Order for query
if `pk:[id,name,age]` then u must maintain left-> right order
`[1,"John" , undefined]` ✅ but `[1,undefined,32]` ❌
and so on

```ts
await mydb
  .query("Employees")
  .where("office", "==", "HQ")
  .where("age", ">=", 25)
  .asc("age")
  .limit(20)
  .all();

// use composite primary key fetch all records with same name
await mydb.query("Employees").where("name", "==", "John Doe").all();
```

### 3. Update/Remove

and similar operations for `update` and `remove`. ends with `.exec()`

```ts
// update
mydb
  .update("Employees", {
    salary: 100_000, // partial data
  })
  .where("office", "==", "HQ")
  .where("age", ">=", 25)
  .asc("age")
  .limit(20)
  .exec(); // exec() here

//remove
mydb
  .remove("Employees")
  .where("office", "==", "HQ")
  .where("age", ">=", 25)
  .asc("age")
  .limit(20)
  .exec(); // exec() here
```

u can use `one()` instead of `all()` to get a single result

### 3. Pagination

`offset(a:number)` and `limit(b:number)` clauses are provided , and u can build a paginator very easily

### 4. Subscriptions

This is some `svelte` code and u can use the subscription like that , very easy and intuitive

```ts
let lis: Function[] = [];
let rooms: RoomSchema[] = $state([]);

ChatStore.query(STORES.ROOMS)
  .limit(20)
  .all()
  .then((data) => {
    rooms = data;
  });

lis[0] = ChatStore.subscribe("ROOMS-ADD", (data) => {
  // here data is the full Room Schema
  ...
});
lis[1] = ChatStore.subscribe("ROOMS-UP", (data) => {
  // here data is the Partial Room Schema
  // the Part which is updated
  ...
});
lis[2] = ChatStore.subscribe("ROOMS-RM", (keys) => {
    // here keys are the Primary Keys belonging to the Reocrd
    // which are droped
    ...
});

// clean up the eventListeners on Dismount
onDestroy(() => lis.forEach((l) => l()));
```
