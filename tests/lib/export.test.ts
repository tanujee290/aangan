import { describe, expect, it } from "vitest";
import { csvCell, fileSize, safeFileName, toCsv } from "../../src/lib/export";

describe("export helpers", () => {
  it("escapes CSV cells", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("writes Excel-friendly CSV with a BOM and CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('﻿a,b\r\n1,"x,y"');
  });

  it("formats file sizes", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(2048)).toBe("2 KB");
    expect(fileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fileSize(null)).toBe("");
  });

  it("makes safe file names", () => {
    expect(safeFileName("Lease / Flat 2B?.pdf")).not.toMatch(/[\/?]/);
  });
});
