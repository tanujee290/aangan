import { describe, expect, it } from "vitest";
import { confidence, extractRef, parseAmount, parseCsv, parseDate, parseStatement } from "../../src/lib/reconcile";

describe("bank statement parsing", () => {
  it("reads day-first Indian dates", () => {
    expect(parseDate("05/11/2026")).toBe("2026-11-05");
    expect(parseDate("05-11-26")).toBe("2026-11-05");
    expect(parseDate("05-Nov-2026")).toBe("2026-11-05");
    expect(parseDate("5 Sept 2026")).toBe("2026-09-05");
    expect(parseDate("Nov 5, 2026")).toBe("2026-11-05");
    expect(parseDate("2026-11-05")).toBe("2026-11-05");
    expect(parseDate("05/11/2026 10:30 AM")).toBe("2026-11-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("hello")).toBeNull();
  });

  it("reads amounts with Indian grouping, Cr/Dr and brackets", () => {
    expect(parseAmount("1,23,456.00")).toBe(123456);
    expect(parseAmount("₹ 9,500")).toBe(9500);
    expect(parseAmount("(250.00)")).toBe(-250);
    expect(parseAmount("5,000.00 Cr")).toBe(5000);
    expect(parseAmount("500 Dr")).toBe(-500);
    expect(parseAmount("-75")).toBe(-75);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("0.00")).toBeNull();
  });

  it("finds UPI and NEFT references", () => {
    expect(extractRef("UPI/412345678901/RAVI KUMAR")).toBe("412345678901");
    expect(extractRef("NEFT-HDFCN12345678901234-ASHA")).toBe("HDFCN12345678901234");
    expect(extractRef("ATM WDL")).toBeNull();
  });

  it("parses quoted CSV with any common delimiter", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("finds the header row and reads every transaction", () => {
    const csv = [
      "Account Statement for 1234",
      "Txn Date,Narration,Ref No,Debit,Credit,Balance",
      '05/11/2026,UPI/412345678901/Ravi Kumar,,,"15,000.00","20,000.00"',
      '06/11/2026,ATM WDL,,"2,000.00",,"18,000.00"',
      '06/11/2026,ATM WDL,,"2,000.00",,"16,000.00"',
      "Closing balance,,,,,",
    ].join("\n");
    const { lines, skipped, error } = parseStatement(csv);
    expect(error).toBeUndefined();
    expect(skipped).toBe(1);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ txn_date: "2026-11-05", amount: 15000, reference: "412345678901" });
    expect(lines[1]).toMatchObject({ amount: -2000, reference: null });
    // Identical lines on one day stay separate transactions.
    expect(lines[1].fingerprint).not.toBe(lines[2].fingerprint);
    expect(parseStatement(csv).lines.map((l) => l.fingerprint)).toEqual(lines.map((l) => l.fingerprint));
  });

  it("reads a single amount column with a Cr/Dr type", () => {
    const { lines } = parseStatement("Date,Description,Amount,Type\n2026-11-01,Rent,9000,CR\n2026-11-02,Plumber,1200,DR");
    expect(lines.map((l) => l.amount)).toEqual([9000, -1200]);
  });

  it("explains a missing header", () => {
    expect(parseStatement("foo,bar\n1,2").error).toMatch(/header row/);
  });

  it("buckets confidence scores", () => {
    expect([confidence(95), confidence(60), confidence(10)]).toEqual(["high", "medium", "low"]);
  });
});
