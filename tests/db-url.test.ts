import { describe, expect, it } from "vitest";
import { config } from "../server/config";
import { DatabaseConfigError, connectionOptions } from "../server/db";

const SUPABASE_POOLER = "postgres://postgres.abcdefghijklmnop:p%40ss%23w0rd@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";

describe("connectionOptions", () => {
  it("handles a Supabase transaction-pooler URI: dotted user, encoded password, port 6543, encrypted without a CA", () => {
    const { connectionString, ssl } = connectionOptions(SUPABASE_POOLER);
    const url = new URL(connectionString);
    expect(url.username).toBe("postgres.abcdefghijklmnop");
    expect(decodeURIComponent(url.password)).toBe("p@ss#w0rd");
    expect(url.hostname).toBe("aws-0-eu-west-1.pooler.supabase.com");
    expect(url.port).toBe("6543");
    expect(ssl).toEqual({ rejectUnauthorized: false });
  });

  it("verifies the server when a CA is configured", () => {
    const before = config.databaseCaCert;
    config.databaseCaCert = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----";
    try {
      expect(connectionOptions(SUPABASE_POOLER).ssl).toEqual({ ca: config.databaseCaCert, rejectUnauthorized: true });
    } finally {
      config.databaseCaCert = before;
    }
  });

  it("strips sslmode (it would override our TLS settings) and honours sslmode=disable and localhost", () => {
    expect(connectionOptions("postgres://u:p@db.example.com:5432/d?sslmode=require").connectionString).not.toContain("sslmode");
    expect(connectionOptions("postgres://u:p@db.example.com:5432/d?sslmode=disable").ssl).toBe(false);
    expect(connectionOptions("postgres://u:p@localhost:5432/d").ssl).toBe(false);
    expect(connectionOptions("postgres://u:p@127.0.0.1:5432/d").ssl).toBe(false);
    expect(connectionOptions("postgresql://u:p@db.example.com:5432/d").ssl).toEqual({ rejectUnauthorized: false });
  });

  it("explains an unencoded special character without echoing the password", () => {
    for (const bad of ["postgres://postgres.ref:my@pass@db.example.com:6543/postgres", "postgres://postgres.ref:my#pass@db.example.com:6543/postgres", "postgres://u:p@ss:word@host/db"]) {
      let message = "";
      try {
        connectionOptions(bad);
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseConfigError);
        message = (error as Error).message;
      }
      expect(message).toMatch(/URL-encoded/);
      expect(message).not.toMatch(/my@pass|my#pass|p@ss/);
    }
  });

  it("rejects things that aren't Postgres URLs", () => {
    expect(() => connectionOptions("mysql://u:p@host/db")).toThrow(/postgres:\/\//);
    expect(() => connectionOptions("not a url")).toThrow(DatabaseConfigError);
  });
});
