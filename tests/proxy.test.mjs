import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { NextRequest } from "next/server.js";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../proxy.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
);
const proxyModule = { exports: {} };
new Function("require", "module", "exports", outputText)(
  createRequire(import.meta.url), proxyModule, proxyModule.exports
);
const { proxy } = proxyModule.exports;

delete process.env.CODEWORDS_PREVIEW_AUTH;
delete process.env.CODEWORDS_ACCESS_TOKEN;

function request(origin, method = "GET") {
  return new NextRequest("https://preview.codewords.run/", {
    method,
    headers: origin ? { origin } : {},
  });
}

for (const origin of [
  "https://app.codewords.ai",
  "https://staging.codewords.ai",
  "https://codewords.agemo.ai",
  "https://codewords-staging.agemo.ai",
]) {
  const response = proxy(request(origin));
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  const ancestors = response.headers.get("Content-Security-Policy").split(" ");
  assert.ok(ancestors.includes("*.codewords.ai"));
  assert.ok(ancestors.includes("*.agemo.ai"));
  const preflight = proxy(request(origin, "OPTIONS"));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
}

for (const origin of [
  null,
  "https://evil.example",
  "https://evilcodewords.ai",
  "https://app.codewords.ai.evil.example",
]) {
  assert.equal(proxy(request(origin)).headers.get("Access-Control-Allow-Origin"), null);
  assert.notEqual(proxy(request(origin, "OPTIONS")).status, 204);
}

console.log("PASS: iframe policy, CORS, preflight, existing hosts, and untrusted origins");
