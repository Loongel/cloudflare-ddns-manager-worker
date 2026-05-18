import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker.js";

function makeKv() {
  const values = new Map();
  return {
    async get(key) {
      return values.get(key) || null;
    },
    async put(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
    async list({ prefix = "" } = {}) {
      return {
        keys: [...values.keys()]
          .filter((name) => name.startsWith(prefix))
          .map((name) => ({ name })),
      };
    },
  };
}

async function testTokenId(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const env = {
  CF_API_TOKEN: "cf-token",
  DDNS_ADMIN_TOKEN: "client-secret",
  DDNS_TOKEN: "scoped-secret",
  DDNS_DOMAIN_CONFIGS: JSON.stringify([
    { domain: "home.example.com", zoneId: "zone-1", ttl: 120, proxied: false },
    { domain: "lab.example.net", zoneId: "zone-2", ttl: 300, proxied: true },
  ]),
  CF_API_BASE: "https://api.test/client/v4",
  DDNS_TOKENS: makeKv(),
};

test("health endpoint", async () => {
  const response = await worker.fetch(new Request("https://worker.test/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "cloudflare-ddns-manager-worker" });
});

test("serves manager page", async () => {
  const response = await worker.fetch(new Request("https://worker.test/"), env);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(text, /DDNS 管理器/);
  assert.match(text, /id="enableTokensBtn" disabled>启用所选/);
  assert.match(text, /id="disableTokensBtn" disabled>禁用所选/);
  assert.match(text, /revealTokenBtn/);
});

test("manager summary lists configured DDNS records", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url);
    const type = new URL(text).searchParams.get("type");
    calls.push({ url: text, init });
    if (text.includes("/zones/zone-1/")) {
      return Response.json({
        success: true,
        result: type === "A"
          ? [
              {
                id: "record-a",
                type: "A",
                name: "nas.home.example.com",
                content: "203.0.113.10",
                ttl: 120,
                proxied: false,
                modified_on: "2026-05-18T00:00:00Z",
              },
              {
                id: "record-other",
                type: "A",
                name: "www.example.com",
                content: "203.0.113.20",
                ttl: 120,
                proxied: false,
              },
            ]
          : [],
      });
    }
    return Response.json({
      success: true,
      result: type === "AAAA"
        ? [
            {
              id: "record-aaaa",
              type: "AAAA",
              name: "router.lab.example.net",
              content: "2001:db8::5",
              ttl: 300,
              proxied: true,
            },
          ]
        : [],
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/api/summary", {
        headers: { authorization: "Bearer client-secret" },
      }),
      env,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(
      body.records.map((record) => `${record.type} ${record.name}`),
      ["A nas.home.example.com", "AAAA router.lab.example.net"],
    );
    assert.equal(body.tokens.find((token) => token.role === "admin").value, "client-secret");
    assert.equal(body.tokens.find((token) => token.name === "内置客户端 Token").value, "scoped-secret");
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin can create persistent scoped tokens", async () => {
  const kv = makeKv();
  const response = await worker.fetch(
    new Request("https://worker.test/api/tokens", {
      method: "POST",
      headers: {
        authorization: "Bearer client-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "nas" }),
    }),
    { ...env, DDNS_TOKENS: kv },
  );
  const body = await response.json();
  const stored = JSON.parse(await kv.get(`token:${body.tokenInfo.id}`));

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.tokenInfo.name, "nas");
  assert.equal(stored.active, true);
  assert.equal(stored.value, body.token);
  assert.equal(stored.manageable, true);
  assert.ok(body.token);
});

test("admin can disable and delete scoped tokens", async () => {
  const kv = makeKv();
  await kv.put("token:t1", JSON.stringify({ id: "t1", name: "nas", active: true }));
  await kv.put("token-list:t1", JSON.stringify({ id: "t1", name: "nas", active: true }));

  const disabled = await worker.fetch(
    new Request("https://worker.test/api/tokens", {
      method: "PATCH",
      headers: {
        authorization: "Bearer client-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ids: ["t1"], active: false }),
    }),
    { ...env, DDNS_TOKENS: kv },
  );
  assert.equal(disabled.status, 200);
  assert.equal(JSON.parse(await kv.get("token:t1")).active, false);

  const deleted = await worker.fetch(
    new Request("https://worker.test/api/tokens", {
      method: "DELETE",
      headers: {
        authorization: "Bearer client-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ids: ["t1"] }),
    }),
    { ...env, DDNS_TOKENS: kv },
  );
  assert.equal(deleted.status, 200);
  assert.equal(await kv.get("token:t1"), null);
  assert.equal(await kv.get("token-list:t1"), null);
});

test("admin can delete dns records from manager", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return Response.json({ success: true, result: { id: "record-a" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/api/records", {
        method: "DELETE",
        headers: {
          authorization: "Bearer client-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          records: [{ id: "record-a", domain: "home.example.com", type: "A", name: "nas.home.example.com" }],
        }),
      }),
      env,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.deleted[0].id, "record-a");
    assert.equal(calls[0].init.method, "DELETE");
    assert.match(calls[0].url, /\/zones\/zone-1\/dns_records\/record-a$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manager can delete dns records by host without record id", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/dns_records?")) {
      return Response.json({ success: true, result: [{ id: "record-a" }] });
    }
    return Response.json({ success: true, result: { id: "record-a" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/api/records", {
        method: "DELETE",
        headers: {
          authorization: "Bearer client-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          records: [{ domain: "home.example.com", type: "A", host: "nas" }],
        }),
      }),
      env,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.deleted[0].id, "record-a");
    assert.match(calls[0].url, /type=A/);
    assert.match(calls[0].url, /name=nas\.home\.example\.com/);
    assert.equal(calls[1].init.method, "DELETE");
    assert.match(calls[1].url, /\/zones\/zone-1\/dns_records\/record-a$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scoped delete can skip unowned records during uninstall cleanup", async () => {
  const kv = makeKv();
  await kv.put(
    "owner:A:nas.home.example.com",
    JSON.stringify({ tokenId: "different-token", role: "scoped", updatedAt: new Date().toISOString() }),
  );

  const response = await worker.fetch(
    new Request("https://worker.test/api/records", {
      method: "DELETE",
      headers: {
        authorization: "Bearer scoped-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ignoreUnowned: true,
        records: [{ domain: "home.example.com", type: "A", host: "nas" }],
      }),
    }),
    { ...env, DDNS_TOKENS: kv },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.deleted, []);
  assert.equal(body.skipped[0].reason, "record_not_owned");
});

test("creates A record with inferred caller IPv4", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/dns_records?")) {
      return Response.json({ success: true, result: [] });
    }
    return Response.json({ success: true, result: { id: "record-1" } });
  };

  try {
    const request = new Request(
      "https://worker.test/ddns/update?domain=home.example.com&host=nas",
      {
        headers: {
          authorization: "Bearer client-secret",
          "cf-connecting-ip": "203.0.113.10",
        },
      },
    );
    const response = await worker.fetch(request, env);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.fqdn, "nas.home.example.com");
    assert.equal(body.updates[0].action, "created");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /type=A/);
    assert.match(calls[0].url, /name=nas\.home\.example\.com/);
    assert.equal(calls[1].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      type: "A",
      name: "nas.home.example.com",
      content: "203.0.113.10",
      ttl: 120,
      proxied: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scoped token owns records it creates", async () => {
  const kv = makeKv();
  const scopedEnv = { ...env, DDNS_TOKENS: kv };
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/dns_records?")) {
      return Response.json({ success: true, result: [] });
    }
    return Response.json({ success: true, result: { id: "record-scoped" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/ddns/update?domain=home.example.com&host=nas", {
        headers: {
          authorization: "Bearer scoped-secret",
          "cf-connecting-ip": "203.0.113.10",
        },
      }),
      scopedEnv,
    );
    const owner = JSON.parse(await kv.get("owner:A:nas.home.example.com"));

    assert.equal(response.status, 200);
    assert.equal((await response.json()).updates[0].action, "created");
    assert.equal(owner.tokenId, await testTokenId("scoped-secret"));
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scoped token cannot update unowned records", async () => {
  const kv = makeKv();
  const scopedEnv = { ...env, DDNS_TOKENS: kv };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/dns_records?")) {
      return Response.json({
        success: true,
        result: [{ id: "record-a", content: "203.0.113.9", ttl: 120, proxied: false }],
      });
    }
    return Response.json({ success: true, result: { id: "record-a" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/ddns/update?domain=home.example.com&host=nas", {
        headers: {
          authorization: "Bearer scoped-secret",
          "cf-connecting-ip": "203.0.113.10",
        },
      }),
      scopedEnv,
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "record_not_owned");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updates AAAA record from explicit IPv6", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/dns_records?")) {
      return Response.json({
        success: true,
        result: [{ id: "record-6", content: "2001:db8::1", ttl: 300, proxied: true }],
      });
    }
    return Response.json({ success: true, result: { id: "record-6" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/ddns/update", {
        method: "POST",
        headers: {
          authorization: "Bearer client-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          domain: "lab.example.net",
          host: "router",
          type: "AAAA",
          ipv6: "2001:db8::5",
        }),
      }),
      env,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.updates[0].action, "updated");
    assert.equal(calls[1].init.method, "PUT");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      type: "AAAA",
      name: "router.lab.example.net",
      content: "2001:db8::5",
      ttl: 300,
      proxied: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed explicit IPv6 before calling Cloudflare", async () => {
  const originalFetch = globalThis.fetch;
  let calledCloudflare = false;
  globalThis.fetch = async () => {
    calledCloudflare = true;
    return Response.json({ success: true, result: [] });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/ddns/update", {
        method: "POST",
        headers: {
          authorization: "Bearer client-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          domain: "lab.example.net",
          host: "router",
          type: "AAAA",
          ipv6: ":",
        }),
      }),
      env,
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_ipv6");
    assert.equal(calledCloudflare, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unauthorized and unallowed domains", async () => {
  const unauthorized = await worker.fetch(
    new Request("https://worker.test/ddns/update?domain=home.example.com&host=nas"),
    env,
  );
  assert.equal(unauthorized.status, 401);

  const unallowed = await worker.fetch(
    new Request("https://worker.test/ddns/update?domain=evil.example.com&host=nas", {
      headers: { authorization: "Bearer client-secret", "cf-connecting-ip": "203.0.113.10" },
    }),
    env,
  );
  assert.equal(unallowed.status, 403);
});

test("rejects full FQDN as host", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/ddns/update?domain=home.example.com&host=nas.home.example.com", {
      headers: { authorization: "Bearer client-secret", "cf-connecting-ip": "203.0.113.10" },
    }),
    env,
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_host");
});
