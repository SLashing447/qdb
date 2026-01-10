import "fake-indexeddb/auto";

import { expect, it } from "vitest";
import QDB from "./qdb.js";
import { decode, encode } from "@msgpack/msgpack";

it("runs", async () => {
  const schema = {
    Employee: {
      pk: ["id"],
      index: ["age", "karma", "point"],
      data: {
        id: "" as string,
        age: 0 as number,
        karma: "" as string,
        point: 0 as number,
        name: "" as string,
        salary: 0 as number,
      },
    },
  } as const;

  const db = await new QDB(
    "hello",
    2,
    schema,
    {
      decode: decode,
      encode: encode,
    },
    2000
  ).open();

  const N = 10;

  // 1️⃣ insert employees
  for (let i = 0; i < N; i++) {
    await db.put("Employee", {
      id: `emp-${i}`,
      age: i % 60,
      karma: `k-${i % 10}`,
      point: i,
      name: `Employee ${i}`,
      salary: 30_000 + i,
    });
  }

  // 2️⃣ cold fetch (DB hit)
  const t1 = performance.now();

  const res1 = await db.query("Employee").limit(N).all();

  const t2 = performance.now();

  // 3️⃣ hot fetch (LRU hit)
  const t3 = performance.now();

  const res2 = await db.query("Employee").limit(N).all();

  const t4 = performance.now();

  const dbTime = t2 - t1;
  const cacheTime = t4 - t3;

  // db.subscribe()

  console.log("Cold DB fetch   :", dbTime.toFixed(2), "ms");
  console.log("Hot cache fetch:", cacheTime.toFixed(2), "ms");

  expect(res1.length).toBe(N);
  expect(res2.length).toBe(N);

  // loose assertion — environment-safe
  expect(cacheTime).toBeLessThan(dbTime);
}, 30000000);
