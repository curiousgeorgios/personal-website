import { describe, expect, test } from "vitest";
import { sqliteD1 } from "./sqlite-d1";

// D1 is stricter than SQLite, and the adapter has to be too, or a unit test could pass on a bug that fails in production
describe("sqliteD1", () => {
  test("refuses undefined as a bound value, like D1", () => {
    const db = sqliteD1();
    expect(() => db.prepare("SELECT ? AS n").bind(undefined)).toThrow(/D1_TYPE_ERROR/);
  });

  test("refuses a bind count that doesn't match the placeholders, on every way of running a statement", async () => {
    const db = sqliteD1();
    const mismatch = /Wrong number of parameter bindings/;
    await expect(db.prepare("SELECT ? AS n").first()).rejects.toThrow(mismatch);
    await expect(db.prepare("SELECT ? AS n").bind(1, 2).all()).rejects.toThrow(mismatch);
    await expect(db.prepare("DELETE FROM items WHERE id = ? AND slug = ?").bind(1).run()).rejects.toThrow(mismatch);
    await expect(db.batch([db.prepare("SELECT 1 AS n").bind(1)])).rejects.toThrow(mismatch);
  });

  test("runs a statement whose bind count matches, turning booleans into numbers and keeping null", async () => {
    const db = sqliteD1();
    expect(await db.prepare("SELECT ? AS a, ? AS b, ? AS c").bind(true, false, null).first()).toEqual({ a: 1, b: 0, c: null });
  });
});
