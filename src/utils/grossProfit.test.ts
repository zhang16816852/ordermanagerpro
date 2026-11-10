import { describe, it, expect } from "vitest";
import { resolveUnitCost, computeProfitLine, sumProfit, formatMarginRate } from "./grossProfit";

const noopLookup = () => undefined;

describe("resolveUnitCost", () => {
  it("snapshot cost takes priority when > 0", () => {
    const r = resolveUnitCost({ quantity: 2, unitPrice: 100, snapshotCost: 50 }, () => ({ cost: 30, source: "mapping" }));
    expect(r).toEqual({ cost: 50, source: "snapshot" });
  });
  it("falls back to lookup when snapshot missing/0", () => {
    const r = resolveUnitCost({ quantity: 2, unitPrice: 100, snapshotCost: 0 }, () => ({ cost: 30, source: "mapping" }));
    expect(r).toEqual({ cost: 30, source: "mapping" });
  });
  it("returns null when no cost available (no wholesale fallback)", () => {
    const r = resolveUnitCost({ quantity: 2, unitPrice: 100 }, noopLookup);
    expect(r).toEqual({ cost: null, source: null });
  });
  it("ignores non-finite snapshot", () => {
    const r = resolveUnitCost({ quantity: 2, unitPrice: 100, snapshotCost: NaN }, () => ({ cost: 30, source: "purchase" }));
    expect(r.cost).toBe(30);
  });
});

describe("computeProfitLine", () => {
  it("computes revenue and profit when cost known", () => {
    const l = computeProfitLine({ quantity: 3, unitPrice: 100, snapshotCost: 40 }, noopLookup);
    expect(l.revenue).toBe(300);
    expect(l.cost).toBe(40);
    expect(l.costAmount).toBe(120);
    expect(l.profit).toBe(180);
    expect(l.costKnown).toBe(true);
  });
  it("profit is null when cost unknown", () => {
    const l = computeProfitLine({ quantity: 3, unitPrice: 100 }, noopLookup);
    expect(l.profit).toBeNull();
    expect(l.marginRate).toBeNull();
    expect(l.costKnown).toBe(false);
    expect(l.costAmount).toBe(0);
  });
  it("marginRate is 0 when revenue is 0 but cost known", () => {
    const l = computeProfitLine({ quantity: 0, unitPrice: 100, snapshotCost: 40 }, noopLookup);
    expect(l.marginRate).toBe(0);
  });
});

describe("sumProfit", () => {
  it("aggregates known and unknown lines", () => {
    const lines = [
      computeProfitLine({ quantity: 2, unitPrice: 100, snapshotCost: 40 }, noopLookup),
      computeProfitLine({ quantity: 1, unitPrice: 50 }, noopLookup),
    ];
    const s = sumProfit(lines);
    expect(s.revenue).toBe(250);
    expect(s.costAmount).toBe(80);
    expect(s.knownRevenue).toBe(200);
    expect(s.profit).toBe(120);
    expect(s.unknownCount).toBe(1);
    expect(s.unknownRevenue).toBe(50);
    expect(s.complete).toBe(false);
    expect(s.marginRate).toBeCloseTo(0.6);
  });
  it("complete=true when all costs known", () => {
    const lines = [computeProfitLine({ quantity: 1, unitPrice: 100, snapshotCost: 40 }, noopLookup)];
    expect(sumProfit(lines).complete).toBe(true);
  });
  it("marginRate null when knownRevenue is 0", () => {
    const lines = [computeProfitLine({ quantity: 0, unitPrice: 100, snapshotCost: 40 }, noopLookup)];
    expect(sumProfit(lines).marginRate).toBeNull();
  });
});

describe("formatMarginRate", () => {
  it("returns em dash for null", () => {
    expect(formatMarginRate(null)).toBe("—");
  });
  it("formats percentage", () => {
    expect(formatMarginRate(0.1234)).toBe("12.3%");
  });
  it("returns em dash for non-finite", () => {
    expect(formatMarginRate(Infinity)).toBe("—");
  });
});
