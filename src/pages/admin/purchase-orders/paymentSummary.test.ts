import { describe, it, expect } from "vitest";
import { poPaymentSummary, computePurchasePaidTotals } from "./paymentSummary";

describe("poPaymentSummary", () => {
  it("computes payable/paid/unpaid for normal PO", () => {
    const r = poPaymentSummary(1000, 300);
    expect(r).toEqual({ payable: 1000, paid: 300, unpaid: 700, isCredit: false });
  });
  it("clamps paid to payable", () => {
    const r = poPaymentSummary(1000, 1500);
    expect(r.paid).toBe(1000);
    expect(r.unpaid).toBe(0);
  });
  it("clamps negative paid to 0", () => {
    const r = poPaymentSummary(1000, -50);
    expect(r.paid).toBe(0);
    expect(r.unpaid).toBe(1000);
  });
  it("handles credit (negative) PO", () => {
    const r = poPaymentSummary(-500, 200);
    expect(r.payable).toBe(500);
    expect(r.isCredit).toBe(true);
  });
  it("handles null/undefined", () => {
    const r = poPaymentSummary(null, undefined);
    expect(r).toEqual({ payable: 0, paid: 0, unpaid: 0, isCredit: false });
  });
  it("handles string inputs", () => {
    const r = poPaymentSummary("1000", "300");
    expect(r.payable).toBe(1000);
    expect(r.paid).toBe(300);
  });
});

describe("computePurchasePaidTotals", () => {
  const entries = [
    { id: "e1", amount: 1000, paid_amount: 500 },
    { id: "e2", amount: 200, paid_amount: 200 },
  ];

  it("returns empty when no refs", () => {
    expect(computePurchasePaidTotals(entries, [], [])).toEqual({});
  });

  it("allocates paid by ratio from subRefs", () => {
    const subRefs = [{ entry_id: "e1", reference_id: "po1", amount_applied: 1000 }];
    const r = computePurchasePaidTotals(entries, [], subRefs);
    expect(r.po1).toBeCloseTo(500);
  });

  it("dedupes (po, entry) across subRefs and entryRows", () => {
    const subRefs = [{ entry_id: "e1", reference_id: "po1", amount_applied: 1000 }];
    const entryRows = [{ entry_id: "e1", reference_id: "po1" }];
    const r = computePurchasePaidTotals(entries, entryRows, subRefs);
    expect(r.po1).toBeCloseTo(500);
  });

  it("falls back to entry amount when applied missing", () => {
    const entryRows = [{ entry_id: "e2", reference_id: "po2" }];
    const r = computePurchasePaidTotals(entries, entryRows, []);
    expect(r.po2).toBeCloseTo(200);
  });

  it("skips entries with amount <= 0", () => {
    const zeroEntries = [{ id: "e0", amount: 0, paid_amount: 0 }];
    const subRefs = [{ entry_id: "e0", reference_id: "po1", amount_applied: 100 }];
    const r = computePurchasePaidTotals(zeroEntries, [], subRefs);
    expect(r.po1).toBeUndefined();
  });

  it("skips when ratio <= 0", () => {
    const unpaidEntries = [{ id: "e1", amount: 1000, paid_amount: 0 }];
    const subRefs = [{ entry_id: "e1", reference_id: "po1", amount_applied: 1000 }];
    const r = computePurchasePaidTotals(unpaidEntries, [], subRefs);
    expect(r.po1).toBeUndefined();
  });

  it("handles multiple POs in one entry", () => {
    const subRefs = [
      { entry_id: "e1", reference_id: "po1", amount_applied: 600 },
      { entry_id: "e1", reference_id: "po2", amount_applied: 400 },
    ];
    const r = computePurchasePaidTotals(entries, [], subRefs);
    expect(r.po1).toBeCloseTo(300);
    expect(r.po2).toBeCloseTo(200);
  });
});
