const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
};

const VALID_TYPES = new Set(["A", "AAAA", "AUTO", "BOTH"]);
const MANAGER_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DDNS 管理器</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #17202a; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 18px 48px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 18px; }
    h1 { font-size: 28px; margin: 0; letter-spacing: 0; }
    h2 { font-size: 18px; margin: 0 0 14px; letter-spacing: 0; }
    h3 { font-size: 15px; margin: 18px 0 8px; letter-spacing: 0; }
    section { background: #fff; border: 1px solid #d8dee6; border-radius: 8px; padding: 16px; margin: 14px 0; }
    label { display: grid; gap: 6px; font-size: 13px; color: #4a5565; }
    input, select, button { font: inherit; border-radius: 6px; border: 1px solid #b8c0cc; padding: 9px 10px; background: #fff; color: inherit; }
    button { cursor: pointer; background: #1f6feb; color: #fff; border-color: #1f6feb; }
    button:disabled { cursor: not-allowed; opacity: 0.48; }
    button.secondary { background: #fff; color: #1f2937; border-color: #b8c0cc; }
    button.danger { background: #fff; color: #b42318; border-color: #f0b8b2; }
    button.small { padding: 4px 8px; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .status { min-height: 20px; color: #4a5565; margin: 8px 0 0; }
    .error { color: #b42318; }
    .ok { color: #067647; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { color: #4a5565; font-weight: 600; }
    code { background: #eef2f7; padding: 2px 5px; border-radius: 4px; }
    .token-value { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .token-value code { max-width: 420px; overflow-wrap: anywhere; }
    .muted { color: #667085; }
    .empty { padding: 22px 8px; color: #667085; }
    @media (max-width: 760px) { header, .grid { display: grid; grid-template-columns: 1fr; } table { font-size: 13px; } }
    @media (prefers-color-scheme: dark) {
      body { background: #0f141b; color: #e6edf3; }
      section, input, select, button.secondary { background: #151b23; border-color: #303946; }
      th, td { border-color: #303946; }
      code { background: #212a35; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>DDNS 管理器</h1>
        <div class="muted">Cloudflare Worker DDNS 状态监控与基础管理</div>
      </div>
      <div class="actions">
        <button class="secondary" id="refreshBtn" hidden>刷新</button>
        <button class="danger" id="logoutBtn" hidden>退出</button>
      </div>
    </header>

    <section id="loginPanel">
      <h2>登录</h2>
      <div class="grid">
        <label style="grid-column: span 3;">DDNS Token
          <input id="secretInput" type="password" autocomplete="current-password">
        </label>
        <div class="actions"><button id="saveSecretBtn">打开管理器</button></div>
      </div>
      <div id="loginStatus" class="status">使用 Admin Token 可管理全部记录；使用客户端 Token 只能管理自己创建的记录。</div>
    </section>

    <section id="summaryPanel" hidden>
      <h2>概览</h2>
      <div id="summary" class="muted">尚未加载。</div>
    </section>

    <section id="updatePanel" hidden>
      <h2>更新记录</h2>
      <div class="grid">
        <label>DDNS 后缀 <select id="domainSelect"></select></label>
        <label>节点名称 <input id="hostInput" placeholder="nas"></label>
        <label>记录类型 <select id="typeInput"><option>A</option><option>AAAA</option></select></label>
        <label>IP <input id="ipInput" placeholder="203.0.113.10"></label>
      </div>
      <div class="actions" style="margin-top: 12px;"><button id="updateBtn">更新记录</button></div>
      <div id="updateStatus" class="status"></div>
    </section>

    <section id="tokenPanel" hidden>
      <h2>Token 管理</h2>
      <div class="grid">
        <label style="grid-column: span 3;">Token 名称 <input id="tokenNameInput" placeholder="nas"></label>
        <div class="actions"><button id="createTokenBtn">新建客户端 Token</button></div>
      </div>
      <div class="actions" style="margin-top: 12px;">
        <button class="secondary" id="enableTokensBtn" disabled>启用所选</button>
        <button class="secondary" id="disableTokensBtn" disabled>禁用所选</button>
        <button class="danger" id="deleteTokensBtn" disabled>删除所选</button>
      </div>
      <div id="tokenStatus" class="status"></div>
      <div id="tokens"></div>
    </section>

    <section id="recordsPanel" hidden>
      <h2>DNS 记录</h2>
      <div class="actions"><button class="danger" id="deleteRecordsBtn" disabled>删除所选</button></div>
      <div id="records"></div>
    </section>
  </main>

  <script>
    const $ = (id) => document.getElementById(id);
    const state = { secret: localStorage.getItem("ddnsToken") || "", domains: [], records: [], tokens: [], role: "" };
    const revealedTokens = new Set();
    const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

    function authHeaders() { return { authorization: "Bearer " + state.secret }; }

    async function api(path, init = {}) {
      const response = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init.headers || {}) } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || data.error || "请求失败");
      return data;
    }

    function showAuthed(authed) {
      $("loginPanel").hidden = authed;
      $("summaryPanel").hidden = !authed;
      $("updatePanel").hidden = !authed;
      $("recordsPanel").hidden = !authed;
      $("logoutBtn").hidden = !authed;
      $("refreshBtn").hidden = !authed;
      $("tokenPanel").hidden = !authed || state.role !== "admin";
      updateTokenButtons();
      updateRecordButtons();
    }

    function selected(selector) {
      return [...document.querySelectorAll(selector + ":checked")].map((input) => input.value);
    }

    function render(data) {
      state.role = data.role;
      state.domains = data.domains || [];
      state.records = data.records || [];
      state.tokens = data.tokens || [];
      showAuthed(true);
      $("domainSelect").innerHTML = state.domains.map((item) => '<option value="' + esc(item.domain) + '">' + esc(item.domain) + '</option>').join("");
      $("summary").className = "ok";
      $("summary").textContent = (data.role === "admin" ? "管理员" : "客户端") + " Token，" + state.domains.length + " 个 DDNS 后缀，" + state.records.length + " 条 A/AAAA 记录。最后刷新：" + new Date().toLocaleString();
      renderTokens();
      renderRecords();
    }

    function renderTokens() {
      if (state.role !== "admin") return;
      if (!state.tokens.length) {
        $("tokens").innerHTML = '<div class="empty">没有可显示的 Token。</div>';
        updateTokenButtons();
        return;
      }
      $("tokens").innerHTML = '<table><thead><tr><th></th><th>名称</th><th>权限</th><th>状态</th><th>Token</th><th>ID</th><th>创建时间</th></tr></thead><tbody>' +
        state.tokens.map((token) => '<tr><td>' + (token.manageable ? '<input type="checkbox" class="tokenCheck" value="' + esc(token.id) + '">' : '<span class="muted">-</span>') + '</td><td>' + esc(token.name) + (token.builtIn ? ' <span class="muted">(环境变量)</span>' : '') + '</td><td>' + (token.role === "admin" ? "管理员" : "客户端") + '</td><td>' + (token.active ? "启用" : "禁用") + '</td><td>' + renderTokenValue(token) + '</td><td><code>' + esc(token.id.slice(0, 12)) + '</code></td><td class="muted">' + esc(token.createdAt || '') + '</td></tr>').join("") +
        '</tbody></table>';
      updateTokenButtons();
    }

    function renderTokenValue(token) {
      if (!token.value) {
        return '<span class="muted">历史 Token 未保存原文</span>';
      }
      const visible = revealedTokens.has(token.id);
      const value = visible ? esc(token.value) : "••••••••••••";
      return '<div class="token-value"><code>' + value + '</code><button type="button" class="secondary small revealTokenBtn" data-token-id="' + esc(token.id) + '">' + (visible ? "隐藏" : "显示") + '</button></div>';
    }

    function updateTokenButtons() {
      const count = selected(".tokenCheck").length;
      for (const id of ["enableTokensBtn", "disableTokensBtn", "deleteTokensBtn"]) {
        if ($(id)) $(id).disabled = count === 0;
      }
    }

    function renderRecords() {
      if (!state.records.length) {
        $("records").innerHTML = '<div class="empty">当前 DDNS 后缀下没有 A/AAAA 记录。</div>';
        updateRecordButtons();
        return;
      }
      const groups = new Map();
      for (const record of state.records) {
        const key = record.owner || "管理员 / 未分配";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
      }
      $("records").innerHTML = [...groups.entries()].map(([owner, records]) =>
        '<h3>' + esc(owner) + '</h3><table><thead><tr><th></th><th>节点名称</th><th>DDNS 后缀</th><th>类型</th><th>IP</th><th>TTL</th><th>代理</th><th>修改时间</th></tr></thead><tbody>' +
        records.map((record) => {
          const value = encodeURIComponent(JSON.stringify({ id: record.id, domain: record.domain, type: record.type, name: record.name }));
          return '<tr><td><input type="checkbox" class="recordCheck" value="' + value + '"></td><td><code>' + esc(record.host) + '</code></td><td>' + esc(record.domain) + '</td><td>' + esc(record.type) + '</td><td><code>' + esc(record.content) + '</code></td><td>' + esc(record.ttl) + '</td><td>' + (record.proxied ? "开启" : "关闭") + '</td><td class="muted">' + esc(record.modifiedOn || "") + '</td></tr>';
        }).join("") + '</tbody></table>'
      ).join("");
      updateRecordButtons();
    }

    function updateRecordButtons() {
      if ($("deleteRecordsBtn")) $("deleteRecordsBtn").disabled = selected(".recordCheck").length === 0;
    }

    async function refresh() {
      if (!state.secret) {
        showAuthed(false);
        return;
      }
      $("loginStatus").className = "status";
      $("loginStatus").textContent = "正在校验 Token...";
      try {
        render(await api("/api/summary"));
        localStorage.setItem("ddnsToken", state.secret);
      } catch (error) {
        localStorage.removeItem("ddnsToken");
        state.secret = "";
        $("secretInput").value = "";
        showAuthed(false);
        $("loginStatus").className = "status error";
        $("loginStatus").textContent = "Token 错误：" + error.message;
      }
    }

    async function updateRecord() {
      const domain = $("domainSelect").value;
      const host = $("hostInput").value.trim();
      const type = $("typeInput").value;
      const ip = $("ipInput").value.trim();
      if (!domain || !host || !ip) {
        $("updateStatus").className = "status error";
        $("updateStatus").textContent = "DDNS 后缀、节点名称和 IP 都不能为空。";
        return;
      }
      $("updateStatus").className = "status";
      $("updateStatus").textContent = "正在更新...";
      try {
        const body = { domain, host, type };
        body[type === "AAAA" ? "ipv6" : "ipv4"] = ip;
        const data = await api("/ddns/update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        $("updateStatus").className = "status ok";
        $("updateStatus").textContent = data.fqdn + " " + data.updates.map((item) => item.action).join(", ");
        await refresh();
      } catch (error) {
        $("updateStatus").className = "status error";
        $("updateStatus").textContent = "错误：" + error.message;
      }
    }

    async function createToken() {
      $("tokenStatus").className = "status";
      $("tokenStatus").textContent = "正在创建...";
      try {
        const data = await api("/api/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: $("tokenNameInput").value.trim() || "客户端 Token" }) });
        $("tokenStatus").className = "status ok";
        $("tokenStatus").textContent = "新 Token：" + data.token;
        await refresh();
      } catch (error) {
        $("tokenStatus").className = "status error";
        $("tokenStatus").textContent = "错误：" + error.message;
      }
    }

    async function setTokens(active) {
      const ids = selected(".tokenCheck");
      if (!ids.length) return;
      await api("/api/tokens", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, active }) });
      await refresh();
    }

    async function deleteTokens() {
      const ids = selected(".tokenCheck");
      if (!ids.length || !confirm("确认删除所选客户端 Token？已有 DNS 记录不会一起删除。")) return;
      await api("/api/tokens", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
      await refresh();
    }

    async function deleteRecords() {
      const records = selected(".recordCheck").map((value) => JSON.parse(decodeURIComponent(value)));
      if (!records.length || !confirm("确认删除所选 DNS 记录？这会从 Cloudflare DNS 中移除记录。")) return;
      await api("/api/records", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ records }) });
      await refresh();
    }

    $("saveSecretBtn").onclick = () => { state.secret = $("secretInput").value.trim(); refresh(); };
    $("logoutBtn").onclick = () => { localStorage.removeItem("ddnsToken"); state.secret = ""; $("secretInput").value = ""; showAuthed(false); };
    $("refreshBtn").onclick = refresh;
    $("updateBtn").onclick = updateRecord;
    $("createTokenBtn").onclick = createToken;
    $("enableTokensBtn").onclick = () => setTokens(true);
    $("disableTokensBtn").onclick = () => setTokens(false);
    $("deleteTokensBtn").onclick = deleteTokens;
    $("deleteRecordsBtn").onclick = deleteRecords;
    $("tokens").addEventListener("change", (event) => { if (event.target.classList.contains("tokenCheck")) updateTokenButtons(); });
    $("tokens").addEventListener("click", (event) => {
      const button = event.target.closest(".revealTokenBtn");
      if (!button) return;
      const id = button.dataset.tokenId;
      if (revealedTokens.has(id)) revealedTokens.delete(id);
      else revealedTokens.add(id);
      renderTokens();
    });
    $("records").addEventListener("change", (event) => { if (event.target.classList.contains("recordCheck")) updateRecordButtons(); });
    $("secretInput").value = state.secret;
    showAuthed(false);
    refresh();
  </script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "authorization, content-type",
          },
        });
      }

      if (url.pathname === "/health") {
        return json({ ok: true, service: "cloudflare-ddns-manager-worker" });
      }

      if ((url.pathname === "/" || url.pathname === "/manager") && request.method === "GET") {
        return html(MANAGER_HTML);
      }

      if (url.pathname === "/api/summary") {
        if (request.method !== "GET") {
          return json({ ok: false, error: "method_not_allowed" }, 405);
        }
        assertEnv(env);
        const auth = await requireAuth(request, url, env);
        return json(await getManagerSummary(env, auth));
      }

      if (url.pathname === "/api/tokens") {
        if (!["POST", "PATCH", "DELETE"].includes(request.method)) {
          return json({ ok: false, error: "method_not_allowed" }, 405);
        }
        assertEnv(env);
        const auth = await requireAuth(request, url, env);
        if (request.method === "POST") {
          return json(await createScopedToken(request, env, auth));
        }
        if (request.method === "PATCH") {
          return json(await setScopedTokensActive(request, env, auth));
        }
        return json(await deleteScopedTokens(request, env, auth));
      }

      if (url.pathname === "/api/records") {
        if (request.method !== "DELETE") {
          return json({ ok: false, error: "method_not_allowed" }, 405);
        }
        assertEnv(env);
        const auth = await requireAuth(request, url, env);
        return json(await deleteDnsRecords(request, env, auth));
      }

      if (url.pathname !== "/ddns/update" && url.pathname !== "/update") {
        return json({ ok: false, error: "not_found" }, 404);
      }

      if (request.method !== "GET" && request.method !== "POST") {
        return json({ ok: false, error: "method_not_allowed" }, 405);
      }

      assertEnv(env);
      const auth = await requireAuth(request, url, env);

      const input = await readInput(request, url);
      const configs = parseDomainConfigs(env);
      const selected = selectDomainConfig(configs, input.domain);
      const host = normalizeHost(input.host || input.name || input.hostname);
      const fqdn = buildFqdn(host, selected.domain);
      const recordType = normalizeRecordType(input.type);
      const requested = selectRecordUpdates(recordType, input, request);

      if (requested.length === 0) {
        return json(
          {
            ok: false,
            error: "missing_ip",
            message: "Provide ipv4/ipv6/ip, or let the Worker infer CF-Connecting-IP.",
          },
          400,
        );
      }

      const results = [];
      for (const update of requested) {
        const result = await upsertDnsRecord({
          env,
          zoneId: selected.zoneId,
          type: update.type,
          name: fqdn,
          content: update.content,
          ttl: numberOrDefault(input.ttl, selected.ttl, env.DEFAULT_TTL, 120),
          proxied: booleanOrDefault(input.proxied, selected.proxied, env.DEFAULT_PROXIED, false),
          auth,
        });
        results.push(result);
      }

      return json({
        ok: true,
        domain: selected.domain,
        host,
        fqdn,
        updates: results,
      });
    } catch (error) {
      const status = error.status || 500;
      const payload = {
        ok: false,
        error: error.code || "internal_error",
        message: status === 500 ? "Internal server error" : error.message,
      };
      if (status === 500) {
        console.error(error);
      }
      return json(payload, status);
    }
  },
};

function assertEnv(env) {
  if (!env.CF_API_TOKEN) {
    throw httpError(500, "missing_config", "CF_API_TOKEN is not configured.");
  }
  if (!env.DDNS_ADMIN_TOKEN && !env.DDNS_SECRET) {
    throw httpError(500, "missing_config", "DDNS_ADMIN_TOKEN is not configured.");
  }
  if (!env.DDNS_DOMAIN_CONFIGS) {
    throw httpError(500, "missing_config", "DDNS_DOMAIN_CONFIGS is not configured.");
  }
  if (!env.DDNS_TOKENS) {
    throw httpError(500, "missing_config", "DDNS_TOKENS KV binding is not configured.");
  }
}

async function requireAuth(request, url, env) {
  const header = request.headers.get("authorization") || "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = bearer || url.searchParams.get("token") || "";

  const adminToken = env.DDNS_ADMIN_TOKEN || env.DDNS_SECRET || "";
  if (constantTimeEqual(provided, adminToken)) {
    return { role: "admin", tokenId: "admin", tokenName: "管理员" };
  }

  if (env.DDNS_TOKEN && constantTimeEqual(provided, env.DDNS_TOKEN)) {
    return { role: "scoped", tokenId: await tokenId(provided), tokenName: "内置客户端 Token" };
  }

  const id = provided ? await tokenId(provided) : "";
  const stored = id && env.DDNS_TOKENS ? await kvGetJson(env.DDNS_TOKENS, `token:${id}`) : null;
  if (stored?.active) {
    return { role: "scoped", tokenId: id, tokenName: stored.name || "客户端 Token" };
  }

  throw httpError(401, "unauthorized", "Missing or invalid DDNS token.");
}

async function readInput(request, url) {
  const data = Object.fromEntries(url.searchParams.entries());

  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      Object.assign(data, await request.json());
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.formData();
      for (const [key, value] of form.entries()) {
        data[key] = String(value);
      }
    }
  }

  return normalizeKeys(data);
}

function parseDomainConfigs(env) {
  const raw = String(env.DDNS_DOMAIN_CONFIGS || "").trim();
  let configs;

  if (raw.startsWith("[") || raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    configs = Array.isArray(parsed) ? parsed : [parsed];
  } else {
    configs = raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [domain, zoneId, ttl, proxied] = item.split(":").map((part) => part.trim());
        return { domain, zoneId, ttl, proxied };
      });
  }

  if (!configs.length) {
    throw httpError(500, "missing_config", "DDNS_DOMAIN_CONFIGS has no domain entries.");
  }

  return configs.map((config) => {
    const domain = normalizeDomain(config.domain);
    if (!config.zoneId) {
      throw httpError(500, "missing_config", `Missing zoneId for ${domain}.`);
    }
    return {
      domain,
      zoneId: String(config.zoneId),
      ttl: config.ttl,
      proxied: config.proxied,
    };
  });
}

function selectDomainConfig(configs, domain) {
  if (!domain) {
    throw httpError(400, "missing_domain", "domain is required.");
  }

  const requested = normalizeDomain(domain);
  const selected = configs.find((config) => config.domain === requested);
  if (!selected) {
    throw httpError(403, "domain_not_allowed", `${requested} is not allowed by this Worker.`);
  }
  return selected;
}

function normalizeKeys(data) {
  const aliases = {
    service: "domain",
    suffix: "domain",
    subdomain: "host",
    name: "host",
    hostname: "host",
    ip4: "ipv4",
    ip6: "ipv6",
    addr: "ip",
  };
  const normalized = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    normalized[aliases[lower] || lower] = typeof value === "string" ? value.trim() : value;
  }
  return normalized;
}

function normalizeDomain(value) {
  const domain = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  validateDomainLabels(domain, "domain");
  return domain;
}

function normalizeHost(value) {
  const host = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!host) {
    throw httpError(400, "missing_host", "host is required.");
  }
  if (host.includes("*")) {
    throw httpError(400, "invalid_host", "wildcard hosts are not allowed.");
  }
  validateDomainLabels(host, "host");
  return host;
}

function validateDomainLabels(value, field) {
  const labels = value.split(".");
  if (labels.some((label) => !label)) {
    throw httpError(400, `invalid_${field}`, `${field} contains an empty label.`);
  }
  for (const label of labels) {
    if (label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      throw httpError(400, `invalid_${field}`, `${field} has an invalid label: ${label}`);
    }
  }
}

function buildFqdn(host, domain) {
  if (host === domain || host.endsWith(`.${domain}`)) {
    throw httpError(400, "invalid_host", "Submit only the host part, not the full domain name.");
  }
  const fqdn = `${host}.${domain}`;
  if (fqdn.length > 253) {
    throw httpError(400, "invalid_host", "FQDN is too long.");
  }
  return fqdn;
}

function normalizeRecordType(type) {
  const normalized = String(type || "AUTO").trim().toUpperCase();
  if (!VALID_TYPES.has(normalized)) {
    throw httpError(400, "invalid_type", "type must be one of auto, A, AAAA, both.");
  }
  return normalized;
}

function selectRecordUpdates(type, input, request) {
  const explicitIpv4 = input.ipv4 || (isIpv4(input.ip) ? input.ip : "");
  const explicitIpv6 = input.ipv6 || (isIpv6(input.ip) ? input.ip : "");
  const inferredIp = inferClientIp(request);
  const inferredIpv4 = isIpv4(inferredIp) ? inferredIp : "";
  const inferredIpv6 = isIpv6(inferredIp) ? inferredIp : "";
  const ipv4 = explicitIpv4 || inferredIpv4;
  const ipv6 = explicitIpv6 || inferredIpv6;
  const updates = [];

  if ((type === "AUTO" || type === "A" || type === "BOTH") && ipv4) {
    if (!isIpv4(ipv4)) {
      throw httpError(400, "invalid_ipv4", "ipv4 is invalid.");
    }
    updates.push({ type: "A", content: ipv4 });
  }
  if ((type === "AUTO" || type === "AAAA" || type === "BOTH") && ipv6) {
    if (!isIpv6(ipv6)) {
      throw httpError(400, "invalid_ipv6", "ipv6 is invalid.");
    }
    updates.push({ type: "AAAA", content: ipv6 });
  }

  return updates;
}

function inferClientIp(request) {
  const candidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
    request.headers.get("x-forwarded-for")?.split(",")[0],
  ];
  return candidates.find((value) => value && (isIpv4(value.trim()) || isIpv6(value.trim())))?.trim() || "";
}

async function getManagerSummary(env, auth) {
  const configs = parseDomainConfigs(env);
  const records = [];

  for (const config of configs) {
    const zoneRecords = await listDnsRecords(env, config.zoneId);
    for (const record of zoneRecords) {
      const name = String(record.name || "").toLowerCase();
      if (name === config.domain || !name.endsWith(`.${config.domain}`)) {
        continue;
      }
      const owner = await getRecordOwner(env, record.type, name);
      if (auth.role !== "admin" && owner?.tokenId !== auth.tokenId) {
        continue;
      }
      records.push({
        id: record.id,
        domain: config.domain,
        zoneId: config.zoneId,
        host: name.slice(0, -(config.domain.length + 1)),
        name,
        type: record.type,
        content: record.content,
        ttl: record.ttl,
        proxied: Boolean(record.proxied),
        modifiedOn: record.modified_on || record.modifiedOn || "",
        ownerId: owner?.tokenId || "",
        owner: owner?.tokenName || owner?.tokenId || "管理员 / 未分配",
      });
    }
  }

  return {
    ok: true,
    role: auth.role,
    tokenName: auth.tokenName,
    domains: configs.map((config) => ({
      domain: config.domain,
      ttl: numberOrDefault(config.ttl, env.DEFAULT_TTL, 120),
      proxied: booleanOrDefault(config.proxied, env.DEFAULT_PROXIED, false),
    })),
    tokens: auth.role === "admin" ? await listManagedTokens(env) : [],
    records: records.sort((left, right) => left.name.localeCompare(right.name) || left.type.localeCompare(right.type)),
  };
}

async function createScopedToken(request, env, auth) {
  if (auth.role !== "admin") {
    throw httpError(403, "forbidden", "Only the admin token can create scoped tokens.");
  }
  if (!env.DDNS_TOKENS) {
    throw httpError(500, "missing_config", "DDNS_TOKENS KV binding is not configured.");
  }

  const input = await request.json().catch(() => ({}));
  const name = String(input.name || "客户端 Token").trim().slice(0, 80) || "客户端 Token";
  const token = randomToken();
  const id = await tokenId(token);
  const record = {
    id,
    name,
    role: "scoped",
    value: token,
    manageable: true,
    active: true,
    createdAt: new Date().toISOString(),
  };
  await env.DDNS_TOKENS.put(`token:${id}`, JSON.stringify(record));
  await env.DDNS_TOKENS.put(`token-list:${id}`, JSON.stringify(record));
  return { ok: true, token, tokenInfo: record };
}

async function setScopedTokensActive(request, env, auth) {
  if (auth.role !== "admin") {
    throw httpError(403, "forbidden", "Only the admin token can manage scoped tokens.");
  }
  const input = await request.json().catch(() => ({}));
  const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
  const active = Boolean(input.active);
  const updated = [];

  for (const id of ids) {
    const record = await kvGetJson(env.DDNS_TOKENS, `token:${id}`);
    if (!record || record.builtIn) {
      continue;
    }
    const next = { ...record, active, updatedAt: new Date().toISOString() };
    await env.DDNS_TOKENS.put(`token:${id}`, JSON.stringify(next));
    await env.DDNS_TOKENS.put(`token-list:${id}`, JSON.stringify(next));
    updated.push(id);
  }

  return { ok: true, updated };
}

async function deleteScopedTokens(request, env, auth) {
  if (auth.role !== "admin") {
    throw httpError(403, "forbidden", "Only the admin token can delete scoped tokens.");
  }
  const input = await request.json().catch(() => ({}));
  const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
  const deleted = [];

  for (const id of ids) {
    const record = await kvGetJson(env.DDNS_TOKENS, `token:${id}`);
    if (!record || record.builtIn) {
      continue;
    }
    await env.DDNS_TOKENS.delete(`token:${id}`);
    await env.DDNS_TOKENS.delete(`token-list:${id}`);
    deleted.push(id);
  }

  return { ok: true, deleted };
}

async function deleteDnsRecords(request, env, auth) {
  const input = await request.json().catch(() => ({}));
  const records = Array.isArray(input.records) ? input.records : [];
  const configs = parseDomainConfigs(env);
  const deleted = [];

  for (const item of records) {
    const type = normalizeRecordType(item.type);
    if (type !== "A" && type !== "AAAA") {
      throw httpError(400, "invalid_type", "Only A and AAAA records can be deleted.");
    }
    const config = selectDomainConfig(configs, item.domain);
    const name = item.host ? buildFqdn(normalizeHost(item.host), config.domain) : normalizeDomain(item.name);
    if (name === config.domain || !name.endsWith(`.${config.domain}`)) {
      throw httpError(403, "domain_not_allowed", `${name} is not under ${config.domain}.`);
    }

    if (auth.role !== "admin") {
      const owner = await getRecordOwner(env, type, name);
      if (owner?.tokenId !== auth.tokenId) {
        throw httpError(403, "record_not_owned", `${name} ${type} is not owned by this DDNS token.`);
      }
    }

    const record = item.id
      ? { id: String(item.id) }
      : await findCloudflareRecord(env, config.zoneId, type, name);
    if (!record?.id) {
      continue;
    }

    await deleteCloudflareRecord(env, config.zoneId, record.id);
    await env.DDNS_TOKENS.delete(recordOwnerKey(type, name));
    deleted.push({ id: record.id, type, name });
  }

  return { ok: true, deleted };
}

async function listManagedTokens(env) {
  const tokens = [];
  if (env.DDNS_ADMIN_TOKEN) {
    tokens.push({
      id: await tokenId(env.DDNS_ADMIN_TOKEN),
      name: "Admin Token",
      role: "admin",
      value: env.DDNS_ADMIN_TOKEN,
      active: true,
      builtIn: true,
      manageable: false,
    });
  }
  if (env.DDNS_TOKEN) {
    tokens.push({
      id: await tokenId(env.DDNS_TOKEN),
      name: "内置客户端 Token",
      role: "scoped",
      value: env.DDNS_TOKEN,
      active: true,
      builtIn: true,
      manageable: false,
    });
  }
  if (!env.DDNS_TOKENS?.list) {
    return tokens;
  }
  const listed = await env.DDNS_TOKENS.list({ prefix: "token-list:" });
  for (const key of listed.keys || []) {
    const record = await kvGetJson(env.DDNS_TOKENS, key.name);
    if (record) {
      tokens.push({
        role: "scoped",
        active: true,
        manageable: true,
        ...record,
        name: record.name || "客户端 Token",
      });
    }
  }
  return tokens;
}

async function getRecordOwner(env, type, name) {
  return env.DDNS_TOKENS ? kvGetJson(env.DDNS_TOKENS, recordOwnerKey(type, name)) : null;
}

async function setRecordOwner(env, type, name, auth) {
  if (!env.DDNS_TOKENS || auth.role !== "scoped") {
    return;
  }
  await env.DDNS_TOKENS.put(
    recordOwnerKey(type, name),
    JSON.stringify({
      tokenId: auth.tokenId,
      tokenName: auth.tokenName,
      updatedAt: new Date().toISOString(),
    }),
  );
}

function recordOwnerKey(type, name) {
  return `owner:${type}:${name.toLowerCase()}`;
}

async function kvGetJson(namespace, key) {
  const value = await namespace.get(key);
  if (!value) {
    return null;
  }
  return JSON.parse(value);
}

async function listDnsRecords(env, zoneId) {
  const baseUrl = env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
  const records = [];

  for (const type of ["A", "AAAA"]) {
    const listUrl = new URL(`${baseUrl}/zones/${zoneId}/dns_records`);
    listUrl.searchParams.set("type", type);
    listUrl.searchParams.set("per_page", "100");
    const data = await cloudflareFetch(listUrl, {
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
    });
    records.push(...(data.result || []));
  }

  return records;
}

async function upsertDnsRecord({ env, zoneId, type, name, content, ttl, proxied, auth }) {
  const baseUrl = env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
  const headers = {
    authorization: `Bearer ${env.CF_API_TOKEN}`,
    "content-type": "application/json",
  };
  const searchUrl = new URL(`${baseUrl}/zones/${zoneId}/dns_records`);
  searchUrl.searchParams.set("type", type);
  searchUrl.searchParams.set("name", name);

  const existing = await cloudflareFetch(searchUrl, { headers });
  const body = {
    type,
    name,
    content,
    ttl,
    proxied,
  };

  if (existing.result?.length) {
    const record = existing.result[0];
    if (auth.role !== "admin") {
      const owner = await getRecordOwner(env, type, name);
      if (owner?.tokenId !== auth.tokenId) {
        throw httpError(403, "record_not_owned", `${name} ${type} is not owned by this DDNS token.`);
      }
    }
    if (record.content === content && record.ttl === ttl && record.proxied === proxied) {
      return { type, name, content, action: "unchanged", id: record.id };
    }

    const updated = await cloudflareFetch(`${baseUrl}/zones/${zoneId}/dns_records/${record.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    return { type, name, content, action: "updated", id: updated.result?.id || record.id };
  }

  const created = await cloudflareFetch(`${baseUrl}/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  await setRecordOwner(env, type, name, auth);
  return { type, name, content, action: "created", id: created.result?.id };
}

async function findCloudflareRecord(env, zoneId, type, name) {
  const baseUrl = env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
  const searchUrl = new URL(`${baseUrl}/zones/${zoneId}/dns_records`);
  searchUrl.searchParams.set("type", type);
  searchUrl.searchParams.set("name", name);
  const data = await cloudflareFetch(searchUrl, {
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
  });
  return data.result?.[0] || null;
}

async function deleteCloudflareRecord(env, zoneId, recordId) {
  const baseUrl = env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
  await cloudflareFetch(`${baseUrl}/zones/${zoneId}/dns_records/${recordId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
  });
}

async function cloudflareFetch(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message =
      data.errors?.map((error) => error.message).join("; ") ||
      `Cloudflare API returned HTTP ${response.status}`;
    throw httpError(502, "cloudflare_api_error", message);
  }
  return data;
}

function booleanOrDefault(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return false;
}

function numberOrDefault(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const number = Number(value);
    if (Number.isInteger(number) && number >= 1) {
      return number;
    }
  }
  return 120;
}

function isIpv4(value) {
  if (!value || typeof value !== "string") {
    return false;
  }
  const parts = value.trim().split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
}

function isIpv6(value) {
  if (!value || typeof value !== "string" || !value.includes(":")) {
    return false;
  }
  const text = value.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(text) || text.split("::").length > 2) {
    return false;
  }

  const [left, right = ""] = text.split("::");
  const leftGroups = left ? left.split(":") : [];
  const rightGroups = right ? right.split(":") : [];
  const groups = [...leftGroups, ...rightGroups];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return false;
  }

  return text.includes("::") ? groups.length < 8 : groups.length === 8;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

async function tokenId(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (!left || !right) {
    return false;
  }
  const leftText = String(left);
  const rightText = String(right);
  let diff = leftText.length ^ rightText.length;
  const length = Math.max(leftText.length, rightText.length);
  for (let index = 0; index < length; index += 1) {
    diff |= leftText.charCodeAt(index % leftText.length) ^ rightText.charCodeAt(index % rightText.length);
  }
  return diff === 0;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: HTML_HEADERS,
  });
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
