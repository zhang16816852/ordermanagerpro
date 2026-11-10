import { describe, it, expect } from "vitest";
import { getPoBindStatus, poBindBadge, orderPoBindBadge } from "./poBindStatus";

describe("getPoBindStatus", () => {
  it("returns 'over' when over flag is true", () => {
    expect(getPoBindStatus(10, 5, true)).toBe("over");
  });
  it("returns 'none' when recorded <= 0", () => {
    expect(getPoBindStatus(10, 0)).toBe("none");
    expect(getPoBindStatus(10, -1)).toBe("none");
  });
  it("returns 'covered' when recorded >= pending", () => {
    expect(getPoBindStatus(10, 10)).toBe("covered");
    expect(getPoBindStatus(10, 15)).toBe("covered");
  });
  it("returns 'partial' otherwise", () => {
    expect(getPoBindStatus(10, 5)).toBe("partial");
  });
});

describe("poBindBadge", () => {
  it("returns null for 'none'", () => {
    expect(poBindBadge("none", 10, 0)).toBeNull();
  });
  it("returns green badge for covered", () => {
    const b = poBindBadge("covered", 10, 10);
    expect(b?.text).toBe("已採購 10");
    expect(b?.className).toContain("green");
  });
  it("returns orange badge for partial with correct remaining", () => {
    const b = poBindBadge("partial", 10, 3);
    expect(b?.text).toBe("待採購 7");
  });
  it("returns red badge for over", () => {
    const b = poBindBadge("over", 10, 15);
    expect(b?.text).toBe("採購超量");
  });
});

describe("orderPoBindBadge", () => {
  it("returns null when binds undefined", () => {
    expect(orderPoBindBadge([{ id: "a", quantity: 5, shipped_quantity: 0 }], undefined)).toBeNull();
  });
  it("skips cancelled/discontinued/out_of_stock/return/repair lines", () => {
    const items = [
      { id: "a", quantity: 5, shipped_quantity: 0, status: "cancelled" },
      { id: "b", quantity: 5, shipped_quantity: 0, line_type: "return" },
      { id: "c", quantity: 5, shipped_quantity: 0, is_repair: true },
    ];
    const binds = new Map([["a", { recorded: 5, status: "covered" as const, poIds: [] }]]);
    expect(orderPoBindBadge(items, binds)).toBeNull();
  });
  it("aggregates recorded across items", () => {
    const items = [
      { id: "a", quantity: 5, shipped_quantity: 0 },
      { id: "b", quantity: 5, shipped_quantity: 0 },
    ];
    const binds = new Map([
      ["a", { recorded: 5, status: "covered" as const, poIds: [] }],
      ["b", { recorded: 3, status: "partial" as const, poIds: [] }],
    ]);
    const b = orderPoBindBadge(items, binds);
    expect(b?.text).toBe("待採購 2");
  });
  it("returns null when recorded <= 0 and not over", () => {
    const items = [{ id: "a", quantity: 5, shipped_quantity: 0 }];
    const binds = new Map([["a", { recorded: 0, status: "none" as const, poIds: [] }]]);
    expect(orderPoBindBadge(items, binds)).toBeNull();
  });
});
