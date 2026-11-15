import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getApiBase } from "../src/lib/config";

describe("Deriv API base configuration", () => {
  it("allows per-user onboarding without requiring server-wide account credentials", () => {
    const previous = process.env.DERIV_API_BASE;
    delete process.env.DERIV_APP_ID;
    delete process.env.DERIV_PAT;
    delete process.env.DERIV_ACCOUNT_ID;
    process.env.DERIV_API_BASE = "https://api.derivws.com/";
    try { assert.equal(getApiBase(), "https://api.derivws.com"); }
    finally { if (previous === undefined) delete process.env.DERIV_API_BASE; else process.env.DERIV_API_BASE = previous; }
  });
  it("rejects insecure HTTP API bases", () => {
    const previous = process.env.DERIV_API_BASE;
    process.env.DERIV_API_BASE = "http://api.derivws.com";
    try { assert.throws(() => getApiBase(), /must use https/); }
    finally { if (previous === undefined) delete process.env.DERIV_API_BASE; else process.env.DERIV_API_BASE = previous; }
  });
});
