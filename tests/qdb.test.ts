import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import qdb from "../src/db/qdb"; // Adjust path

describe("QDB - Composite Primary Key Tests", () => {
  const schema = {
    Employee: {
      pk: ["id", "age", "karma"],
      index: ["salary", "name"],
      data: {
        id: 0 as number,
        age: 0 as number,
        karma: "" as string,
        point: 0 as number,
        name: "" as string,
        salary: 0 as number,
      },
    },
  } as const;

  const wire = {
    decode: (x: any) => x,
    encode: (x: any) => x,
  };

  let db: qdb<typeof schema, typeof wire>;

  beforeEach(async () => {
    db = await new qdb(
      "test-db-" + Math.random(), // Unique DB per test
      1,
      schema,
      wire,
      2000
    ).open();
  });

  afterEach(() => {
    db?.close();
  });

  // ============================================
  // INSERT / UPDATE TESTS
  // ============================================

  describe("Insert and Update", () => {
    it("should insert records with composite PK", async () => {
      await db.put("Employee", {
        id: 1,
        age: 25,
        karma: "k-100",
        point: 10,
        name: "Alice",
        salary: 50000,
      });

      const result = await db
        .query("Employee")
        .where("id", "==", 1)
        .where("age", "==", 25)
        .where("karma", "==", "k-100")
        .one();

      expect(result).toBeDefined();
      expect(result?.name).toBe("Alice");
    });

    it("should update existing record when PK matches", async () => {
      // Insert
      await db.put("Employee", {
        id: 1,
        age: 25,
        karma: "k-100",
        point: 10,
        name: "Alice",
        salary: 50000,
      });

      // Update (same PK)
      await db.put("Employee", {
        id: 1,
        age: 25,
        karma: "k-100",
        point: 20,
        name: "Alice Updated",
        salary: 60000,
      });

      const result = await db
        .query("Employee")
        .where("id", "==", 1)
        .where("age", "==", 25)
        .where("karma", "==", "k-100")
        .one();

      expect(result?.name).toBe("Alice Updated");
      expect(result?.salary).toBe(60000);
      expect(result?.point).toBe(20);

      // Should only have 1 record
      const all = await db.query("Employee").all();
      expect(all.length).toBe(1);
    });

    it("should create new record when any PK component differs", async () => {
      await db.put("Employee", {
        id: 1,
        age: 25,
        karma: "k-100",
        point: 10,
        name: "Alice",
        salary: 50000,
      });

      // Different karma (3rd PK component)
      await db.put("Employee", {
        id: 1,
        age: 25,
        karma: "k-200",
        point: 20,
        name: "Bob",
        salary: 60000,
      });

      const all = await db.query("Employee").all();
      expect(all.length).toBe(2);
    });
  });

  // ============================================
  // QUERY BY EXACT MATCH (ALL COMPONENTS)
  // ============================================

  describe("Query by All PK Components", () => {
    beforeEach(async () => {
      // Insert test data
      for (let i = 0; i < 10; i++) {
        await db.put("Employee", {
          id: i,
          age: 20 + i,
          karma: `k-${i}`,
          point: i,
          name: `Employee ${i}`,
          salary: 30000 + i * 1000,
        });
      }
    });

    it("should find exact match with all 3 PK components", async () => {
      const result = await db
        .query("Employee")
        .where("id", "==", 5)
        .where("age", "==", 25)
        .where("karma", "==", "k-5")
        .one();

      expect(result).toBeDefined();
      expect(result?.name).toBe("Employee 5");
      expect(result?.salary).toBe(35000);
    });

    it("should return undefined for non-existent exact match", async () => {
      const result = await db
        .query("Employee")
        .where("id", "==", 5)
        .where("age", "==", 25)
        .where("karma", "==", "k-999") // Wrong karma
        .one();

      expect(result).toBeUndefined();
    });
  });

  // ============================================
  // PREFIX QUERIES
  // ============================================

  describe("Prefix Queries", () => {
    beforeEach(async () => {
      // Create records with overlapping PK prefixes
      await db.put("Employee", {
        id: 0,
        age: 10,
        karma: "k-0",
        point: 1,
        name: "A",
        salary: 30000,
      });
      await db.put("Employee", {
        id: 0,
        age: 10,
        karma: "k-100",
        point: 2,
        name: "B",
        salary: 31000,
      });
      await db.put("Employee", {
        id: 0,
        age: 10,
        karma: "k-200",
        point: 3,
        name: "C",
        salary: 32000,
      });
      await db.put("Employee", {
        id: 0,
        age: 12,
        karma: "k-0",
        point: 4,
        name: "D",
        salary: 33000,
      });
      await db.put("Employee", {
        id: 0,
        age: 12,
        karma: "k-100",
        point: 5,
        name: "E",
        salary: 34000,
      });
      await db.put("Employee", {
        id: 1,
        age: 10,
        karma: "k-0",
        point: 6,
        name: "F",
        salary: 35000,
      });
      await db.put("Employee", {
        id: 1,
        age: 10,
        karma: "k-100",
        point: 7,
        name: "G",
        salary: 36000,
      });
    });

    it("should query by first PK component only (id)", async () => {
      const results = await db.query("Employee").where("id", "==", 0).all();

      expect(results.length).toBe(5); // All with id=0
      expect(results.every((r) => r.id === 0)).toBe(true);
    });

    it("should query by first 2 PK components (id, age)", async () => {
      const results = await db
        .query("Employee")
        .where("id", "==", 0)
        .where("age", "==", 10)
        .all();

      expect(results.length).toBe(3); // id=0, age=10
      expect(results.map((r) => r.name).sort()).toEqual(["A", "B", "C"]);
    });

    it("should return results in lexicographic order", async () => {
      const results = await db
        .query("Employee")
        .where("id", "==", 0)
        .where("age", "==", 10)
        .all();

      // Should be ordered by karma: k-0, k-100, k-200
      expect(results[0].karma).toBe("k-0");
      expect(results[1].karma).toBe("k-100");
      expect(results[2].karma).toBe("k-200");
    });
  });

  // ============================================
  // RANGE QUERIES
  // ============================================

  describe("Range Queries on Last PK Component", () => {
    beforeEach(async () => {
      // Same id and age, varying karma
      await db.put("Employee", {
        id: 5,
        age: 25,
        karma: "k-100",
        point: 1,
        name: "A",
        salary: 30000,
      });
      await db.put("Employee", {
        id: 5,
        age: 25,
        karma: "k-200",
        point: 2,
        name: "B",
        salary: 31000,
      });
      await db.put("Employee", {
        id: 5,
        age: 25,
        karma: "k-300",
        point: 3,
        name: "C",
        salary: 32000,
      });
      await db.put("Employee", {
        id: 5,
        age: 25,
        karma: "k-400",
        point: 4,
        name: "D",
        salary: 33000,
      });
      await db.put("Employee", {
        id: 5,
        age: 25,
        karma: "k-500",
        point: 5,
        name: "E",
        salary: 34000,
      });
    });

    it("should support > on last PK component", async () => {
      const results = await db
        .query("Employee")
        .where("id", "==", 5)
        .where("age", "==", 25)
        .where("karma", ">", "k-300")
        .all();

      expect(results.length).toBe(2); // k-400, k-500
      expect(results.map((r) => r.name)).toEqual(["D", "E"]);
    });

    it("should support >= on last PK component", async () => {
      const results = await db
        .query("Employee")
        .where("id", "==", 5)
        .where("age", "==", 25)
        .where("karma", ">=", "k-300")
        .all();

      expect(results.length).toBe(3); // k-300, k-400, k-500
      expect(results.map((r) => r.name)).toEqual(["C", "D", "E"]);
    });

    it("should support < on last PK component", async () => {
      const results = await db
        .query("Employee")
        .where("id", "==", 5)
        .where("age", "==", 25)
        .where("karma", "<", "k-300")
        .all();

      expect(results.length).toBe(2); // k-100, k-200
      expect(results.map((r) => r.name)).toEqual(["A", "B"]);
    });

    it("should support <= on last PK component", async () => {
      const results = await db
        .query("Employee")
        .where("id", "==", 5)
        .where("age", "==", 25)
        .where("karma", "<=", "k-300")
        .all();

      expect(results.length).toBe(3); // k-100, k-200, k-300
      expect(results.map((r) => r.name)).toEqual(["A", "B", "C"]);
    });
  });

  describe("Range Queries on First PK Component", () => {
    beforeEach(async () => {
      for (let i = 0; i < 10; i++) {
        await db.put("Employee", {
          id: i,
          age: 20,
          karma: "k-0",
          point: i,
          name: `Employee ${i}`,
          salary: 30000,
        });
      }
    });

    it("should support > on first component", async () => {
      const results = await db.query("Employee").where("id", ">", 5).all();

      expect(results.length).toBe(4); // 6, 7, 8, 9
      expect(results.map((r) => r.id)).toEqual([6, 7, 8, 9]);
    });

    it("should support >= on first component", async () => {
      const results = await db.query("Employee").where("id", ">=", 5).all();

      expect(results.length).toBe(5); // 5, 6, 7, 8, 9
      expect(results.map((r) => r.id)).toEqual([5, 6, 7, 8, 9]);
    });

    it("should support <= on first component", async () => {
      const results = await db.query("Employee").where("id", "<=", 5).all();

      expect(results.length).toBe(6); // 0, 1, 2, 3, 4, 5
      expect(results.map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5]);
    });
  });

  // ============================================
  // ERROR CASES
  // ============================================

  describe("Error Cases", () => {
    it("should throw error for non-contiguous PK queries", async () => {
      await expect(async () => {
        await db
          .query("Employee")
          .where("id", "==", 0)
          .where("karma", "==", "k-100") // Skips age!
          .all();
      }).rejects.toThrow(/contiguous/i);
    });

    it("should throw error for range in middle of composite PK", async () => {
      await expect(async () => {
        await db
          .query("Employee")
          .where("id", ">", 0)
          .where("age", "==", 25) // Can't query after range!
          .all();
      }).rejects.toThrow(/cannot have conditions on later components/i);
    });
  });

  // ============================================
  // ORDERING & PAGINATION
  // ============================================

  describe("Ordering and Pagination", () => {
    beforeEach(async () => {
      for (let i = 0; i < 20; i++) {
        await db.put("Employee", {
          id: Math.floor(i / 4), // 5 groups
          age: 20 + (i % 4),
          karma: `k-${i}`,
          point: i,
          name: `Employee ${i}`,
          salary: 30000 + i * 1000,
        });
      }
    });

    it("should order by first PK component ascending", async () => {
      const results = await db.query("Employee").asc("id").all();

      const ids = results.map((r) => r.id);
      expect(ids[0]).toBeLessThanOrEqual(ids[ids.length - 1]);
    });

    it("should order by first PK component descending", async () => {
      const results = await db.query("Employee").desc("id").all();

      const ids = results.map((r) => r.id);
      expect(ids[0]).toBeGreaterThanOrEqual(ids[ids.length - 1]);
    });

    it("should support limit", async () => {
      const results = await db
        .query("Employee")
        .where("id", "==", 2)
        .limit(2)
        .all();

      expect(results.length).toBe(2);
    });

    it("should support offset", async () => {
      const all = await db.query("Employee").where("id", "==", 2).all();

      const offsetResults = await db
        .query("Employee")
        .where("id", "==", 2)
        .offset(1)
        .all();

      expect(offsetResults.length).toBe(all.length - 1);
      expect(offsetResults[0].karma).toBe(all[1].karma);
    });

    it("should support limit + offset", async () => {
      const results = await db
        .query("Employee")
        .where("id", "==", 2)
        .offset(1)
        .limit(2)
        .all();

      expect(results.length).toBe(2);
    });
  });

  // ============================================
  // MIXED QUERIES (PK + INDEX)
  // ============================================

  describe("Mixed PK and Index Queries", () => {
    beforeEach(async () => {
      await db.put("Employee", {
        id: 0,
        age: 10,
        karma: "k-0",
        point: 1,
        name: "Alice",
        salary: 50000,
      });
      await db.put("Employee", {
        id: 0,
        age: 10,
        karma: "k-100",
        point: 2,
        name: "Bob",
        salary: 60000,
      });
      await db.put("Employee", {
        id: 0,
        age: 10,
        karma: "k-200",
        point: 3,
        name: "Charlie",
        salary: 70000,
      });
      await db.put("Employee", {
        id: 0,
        age: 12,
        karma: "k-0",
        point: 4,
        name: "David",
        salary: 55000,
      });
    });

    it("should combine PK and index filters", async () => {
      const results = await db
        .query("Employee")
        .where("id", "==", 0)
        .where("age", "==", 10)
        .where("salary", ">", 55000) // Index query
        .all();

      expect(results.length).toBe(2); // Bob and Charlie
      expect(results.map((r) => r.name).sort()).toEqual(["Bob", "Charlie"]);
    });

    it("should filter by name index", async () => {
      const result = await db
        .query("Employee")
        .where("id", "==", 0)
        .where("name", "==", "Bob")
        .one();

      expect(result).toBeDefined();
      expect(result?.karma).toBe("k-100");
    });
  });

  // ============================================
  // EDGE CASES
  // ============================================

  describe("Edge Cases", () => {
    it("should handle empty result set", async () => {
      const results = await db.query("Employee").where("id", "==", 999).all();

      expect(results).toEqual([]);
    });

    it("should handle duplicate inserts (update)", async () => {
      const record = {
        id: 1,
        age: 25,
        karma: "k-100",
        point: 10,
        name: "Test",
        salary: 50000,
      };

      await db.put("Employee", record);
      await db.put("Employee", { ...record, salary: 60000 });
      await db.put("Employee", { ...record, salary: 70000 });

      const all = await db.query("Employee").all();
      expect(all.length).toBe(1);
      expect(all[0].salary).toBe(70000);
    });

    it("should handle string comparison in karma", async () => {
      await db.put("Employee", {
        id: 0,
        age: 10,
        karma: "aaa",
        point: 1,
        name: "A",
        salary: 30000,
      });
      await db.put("Employee", {
        id: 0,
        age: 10,
        karma: "bbb",
        point: 2,
        name: "B",
        salary: 31000,
      });
      await db.put("Employee", {
        id: 0,
        age: 10,
        karma: "zzz",
        point: 3,
        name: "C",
        salary: 32000,
      });

      const results = await db
        .query("Employee")
        .where("id", "==", 0)
        .where("age", "==", 10)
        .where("karma", ">", "aaa")
        .all();

      expect(results.length).toBe(2);
      expect(results.map((r) => r.karma)).toEqual(["bbb", "zzz"]);
    });
  });
});
