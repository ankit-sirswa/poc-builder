import { describe, expect, it } from "vitest";
import { describeNetworkError } from "../server/fetcher";

const err = (props: Record<string, unknown>, cause?: Record<string, unknown>) => Object.assign(new Error("x"), props, cause ? { cause } : {});

describe("describeNetworkError", () => {
  it("names the common failures in plain words", () => {
    expect(describeNetworkError(err({ name: "TimeoutError" }))).toBe("timed out");
    expect(describeNetworkError(err({ name: "AbortError" }))).toBe("timed out");
    expect(describeNetworkError(err({}, { code: "UND_ERR_CONNECT_TIMEOUT" }))).toBe("timed out");
    expect(describeNetworkError(err({}, { code: "ENOTFOUND" }))).toBe("DNS lookup failed");
    expect(describeNetworkError(err({}, { code: "EAI_AGAIN" }))).toBe("DNS lookup failed");
    expect(describeNetworkError(err({}, { code: "ECONNREFUSED" }))).toBe("connection refused");
    expect(describeNetworkError(err({}, { code: "ECONNRESET" }))).toBe("connection reset");
    expect(describeNetworkError(err({}, { code: "UND_ERR_SOCKET" }))).toBe("connection reset");
    expect(describeNetworkError(err({}, { code: "CERT_HAS_EXPIRED" }))).toBe("TLS problem (CERT_HAS_EXPIRED)");
  });

  it("falls back to the error code, or a generic label, without leaking anything else", () => {
    expect(describeNetworkError(err({}, { code: "EHOSTUNREACH" }))).toBe("network error (EHOSTUNREACH)");
    expect(describeNetworkError(new Error("https://secret.example/?key=abc"))).toBe("network error");
    expect(describeNetworkError(undefined)).toBe("network error");
  });
});
