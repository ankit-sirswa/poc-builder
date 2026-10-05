import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanEnv } from "../server/env";

describe("cleanEnv", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it("leaves a clean value alone, silently", () => {
    expect(cleanEnv("KEY", "abc123")).toBe("abc123");
    expect(warn).not.toHaveBeenCalled();
  });

  it("strips the quotes and whitespace a dashboard paste brings along, and says which variable", () => {
    expect(cleanEnv("KEY", '"abc123"')).toBe("abc123");
    expect(cleanEnv("KEY", "'abc123'")).toBe("abc123");
    expect(cleanEnv("KEY", "  abc123 \n")).toBe("abc123");
    expect(cleanEnv("KEY", ' " abc123 " ')).toBe("abc123");
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0][0]).toContain("KEY");
    expect(String(warn.mock.calls[0][0])).not.toContain("abc123"); // never the value
  });

  it("only strips a matching pair, and not from the middle", () => {
    expect(cleanEnv("KEY", `"abc`)).toBe(`"abc`);
    expect(cleanEnv("KEY", `abc"`)).toBe(`abc"`);
    expect(cleanEnv("KEY", `a"b"c`)).toBe(`a"b"c`);
  });

  it("treats empty and missing as unset", () => {
    expect(cleanEnv("KEY", undefined)).toBeUndefined();
    expect(cleanEnv("KEY", "")).toBeUndefined();
    expect(cleanEnv("KEY", '  ""  ')).toBeUndefined();
  });
});
