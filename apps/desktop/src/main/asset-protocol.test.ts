import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveAssetProtocolRequest } from "./asset-protocol.ts";

function assetUrl(path: string) {
  return `teamaligned-asset://local/${encodeURIComponent(path)}`;
}

test("resolveAssetProtocolRequest accepts existing assets under allowed roots", () => {
  const root = "/Users/alex/.teamaligned";
  const assetPath = "/Users/alex/.teamaligned/workspaces/agents/agent-a/avatar.png";
  const result = resolveAssetProtocolRequest(assetUrl(assetPath), [root], () => true);

  assert.equal(result.ok, true);
  assert.equal(result.assetPath, resolve(assetPath));
});

test("resolveAssetProtocolRequest rejects assets outside allowed roots", () => {
  const result = resolveAssetProtocolRequest(assetUrl("/Users/alex/.ssh/id_rsa"), ["/Users/alex/.teamaligned"], () => true);

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, "outside_allowed_roots");
});

test("resolveAssetProtocolRequest rejects missing assets without throwing", () => {
  const result = resolveAssetProtocolRequest(
    assetUrl("/Users/alex/.teamaligned/avatars/missing.png"),
    ["/Users/alex/.teamaligned"],
    () => false,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.reason, "missing_asset");
});

test("resolveAssetProtocolRequest rejects malformed asset URLs", () => {
  const invalidHost = resolveAssetProtocolRequest(assetUrl("/Users/alex/.teamaligned/avatar.png").replace("local", "remote"), [
    "/Users/alex/.teamaligned",
  ]);
  const invalidEncoding = resolveAssetProtocolRequest("teamaligned-asset://local/%E0%A4%A", [
    "/Users/alex/.teamaligned",
  ]);

  assert.equal(invalidHost.ok, false);
  assert.equal(invalidHost.status, 400);
  assert.equal(invalidEncoding.ok, false);
  assert.equal(invalidEncoding.status, 400);
});
