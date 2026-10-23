import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockCrossSite } from "./http";

const req = (headers: Record<string, string>) => new Request("http://127.0.0.1:3460/api/projects", { method: "POST", headers: { host: "127.0.0.1:3460", ...headers } });

describe("blockCrossSite", () => {
  it("allows the studio's own pages and scripts", () => {
    assert.equal(blockCrossSite(req({})), null);
    assert.equal(blockCrossSite(req({ "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3460" })), null);
    assert.equal(blockCrossSite(req({ "sec-fetch-site": "none" })), null);
  });

  it("refuses writes from other sites", () => {
    assert.equal(blockCrossSite(req({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }))?.status, 403);
    assert.equal(blockCrossSite(req({ origin: "https://evil.example" }))?.status, 403);
    assert.equal(blockCrossSite(req({ origin: "null" }))?.status, 403);
    assert.equal(blockCrossSite(req({ "sec-fetch-site": "same-site", origin: "http://localhost:3000" }))?.status, 403);
  });
});
