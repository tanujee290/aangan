import { describe, expect, it } from "vitest";
import { currentPeriod, initials, money, shiftPeriod, tone, upiLink, waLink, waNumber } from "../../src/lib/format";

describe("format", () => {
  it("formats rupees with Indian grouping", () => {
    expect(money(123456)).toBe("₹1,23,456");
    expect(money("9500.5")).toBe("₹9,500.50");
    expect(money(Number.NaN)).toBe("₹0.00");
  });

  it("works with periods", () => {
    expect(currentPeriod(new Date(2026, 0, 15))).toBe("2026-01");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
  });

  it("builds initials", () => {
    expect(initials("ravi kumar sharma")).toBe("RK");
    expect(initials("  Asha ")).toBe("A");
  });

  it("normalises WhatsApp numbers", () => {
    expect(waNumber("98765 43210")).toBe("919876543210");
    expect(waNumber("09876543210")).toBe("919876543210");
    expect(waNumber("+44 7700 900123")).toBe("447700900123");
    expect(waNumber("")).toBeNull();
    expect(waLink("9876543210", "Rent due ₹5,000")).toBe(`https://wa.me/919876543210?text=${encodeURIComponent("Rent due ₹5,000")}`);
  });

  it("builds UPI payment links", () => {
    const link = new URL(upiLink({ upi: "owner@upi", payee: "Asha Rao", amount: 15000, note: "Nov rent" }));
    expect(link.protocol).toBe("upi:");
    expect(Object.fromEntries(link.searchParams)).toEqual({ pa: "owner@upi", pn: "Asha Rao", cu: "INR", am: "15000.00", tn: "Nov rent" });
    expect(upiLink({ upi: "a@b", payee: "A", amount: 0 })).not.toContain("am=");
  });

  it("gives a stable avatar tone", () => {
    expect(tone("Ravi")).toBe(tone("Ravi"));
    expect(tone("Ravi")).toBeGreaterThanOrEqual(0);
    expect(tone("Ravi")).toBeLessThan(7);
  });
});
