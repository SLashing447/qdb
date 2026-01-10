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

### Storage

Indexes and primary keys are stored plaintext and any fields that are not index is mushed into a object then serialized/deserialized using a user given custom encode/decode function

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
    pk: ["name","id"],
    index:["age","office"],
    data: {} as Employee & {
        // u can add extra fields not in ur interface
        years:number;
    }
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
primary keys and indexes

```ts
mydb
  .query("Employees")
  .where("office", "==", "HQ")
  .where("age", ">=", 25)
  .asc("age")
  .limit(20)
  .all();
```

### 3. Update/Remove

and similar operations for `update` and `remove`

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
