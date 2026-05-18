import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const clientPath = resolve("scripts/ddns-client.sh");

test("client install writes private config and five-minute crontab", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCrontab = join(fakeBin, "crontab");
  await writeFile(
    fakeCrontab,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-l" ]]; then
  cat "\${HOME}/crontab.current" 2>/dev/null || exit 1
else
  cp "$1" "\${HOME}/crontab.installed"
fi
`,
  );
  await chmod(fakeCrontab, 0o755);

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--output" ]]; then
    j=$((i + 1))
    out="\${!j}"
  fi
done
printf '{"ok":true}\\n' > "$out"
printf '200\\napplication/json'
`,
  );
  await chmod(fakeCurl, 0o755);

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--install",
      "--manage-endpoint",
      "worker.example",
      "--ddns-token",
      "client-secret",
      "--ddns-suffix",
      "home.example.com",
      "--sub-domain",
      "nas",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const configPath = join(home, ".config/cf-ddns-manager/client.env");
  const config = await readFile(configPath, "utf8");
  assert.match(config, /^URL=https:\/\/worker\.example\/ddns\/update$/m);
  assert.match(config, /^TOKEN=client-secret$/m);
  assert.match(config, /^DOMAIN=home\.example\.com$/m);
  assert.match(config, /^HOST=nas$/m);
  assert.match(config, /^DDNS_USER_AGENT=cf-ddns-manager-client\/1\.0$/m);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);

  const cron = await readFile(join(home, "crontab.installed"), "utf8");
  assert.match(
    cron,
    new RegExp(`^\\*/5 \\* \\* \\* \\* ${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.local/share/cf-ddns-manager/ddns-client\\.sh --config .*client\\.env >> .*client\\.log 2>&1 # cf-ddns-manager$`, "m"),
  );
  assert.doesNotMatch(cron, /client-secret/);

  const installedScript = join(home, ".local/share/cf-ddns-manager/ddns-client.sh");
  assert.equal((await stat(installedScript)).mode & 0o777, 0o700);
});

test("online piped install persists script before writing crontab", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCrontab = join(fakeBin, "crontab");
  await writeFile(
    fakeCrontab,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-l" ]]; then
  cat "\${HOME}/crontab.current" 2>/dev/null || exit 1
else
  cp "$1" "\${HOME}/crontab.installed"
fi
`,
  );
  await chmod(fakeCrontab, 0o755);

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--output" ]]; then
    j=$((i + 1))
    out="\${!j}"
  fi
done
if [[ -n "$out" ]]; then
  printf '{"ok":true}\\n' > "$out"
  printf '200\\napplication/json'
else
  cat "$SCRIPT_FIXTURE"
fi
`,
  );
  await chmod(fakeCurl, 0o755);

  const script = await readFile(clientPath, "utf8");
  const result = spawnSync(
    "bash",
    [
      "-s",
      "--",
      "--install",
      "--manage-endpoint",
      "worker.example",
      "--ddns-token",
      "client-secret",
      "--ddns-suffix",
      "home.example.com",
      "--sub-domain",
      "nas",
    ],
    {
      cwd: home,
      input: script,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
        SCRIPT_FIXTURE: clientPath,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const installedScript = join(home, ".local/share/cf-ddns-manager/ddns-client.sh");
  assert.equal((await stat(installedScript)).mode & 0o777, 0o700);
  const cron = await readFile(join(home, "crontab.installed"), "utf8");
  assert.match(cron, /\/\.local\/share\/cf-ddns-manager\/ddns-client\.sh --config /);
  assert.doesNotMatch(cron, new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/ddns-client\\.sh`));
});

test("client install is idempotent for crontab entries", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCrontab = join(fakeBin, "crontab");
  await writeFile(
    fakeCrontab,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-l" ]]; then
  cat "\${HOME}/crontab.current" 2>/dev/null || exit 1
else
  cp "$1" "\${HOME}/crontab.installed"
fi
`,
  );
  await chmod(fakeCrontab, 0o755);

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--output" ]]; then
    j=$((i + 1))
    out="\${!j}"
  fi
done
printf '{"ok":true}\\n' > "$out"
printf '200\\napplication/json'
`,
  );
  await chmod(fakeCurl, 0o755);

  await writeFile(
    join(home, "crontab.current"),
    [
      "0 0 * * * /usr/bin/true # keep-me",
      "*/5 * * * * /old/path/ddns-client.sh --config /old/client.env # cf-ddns-manager",
      "",
    ].join("\n"),
  );

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--install",
      "--manage-endpoint",
      "worker.example",
      "--ddns-token",
      "client-secret",
      "--ddns-suffix",
      "home.example.com",
      "--sub-domain",
      "nas",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Installed current user crontab:/);
  assert.match(result.stdout, /Installed cf-ddns-manager client/);

  const cron = await readFile(join(home, "crontab.installed"), "utf8");
  assert.match(cron, /# keep-me/);
  assert.equal((cron.match(/# cf-ddns-manager/g) || []).length, 1);
  assert.doesNotMatch(cron, /\/old\/path\/ddns-client\.sh/);
});

test("client uninstall deletes remote records and local install", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCrontab = join(fakeBin, "crontab");
  await writeFile(
    fakeCrontab,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-l" ]]; then
  cat "\${HOME}/crontab.current" 2>/dev/null || exit 1
else
  cp "$1" "\${HOME}/crontab.installed"
fi
`,
  );
  await chmod(fakeCrontab, 0o755);

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
data=""
for ((i=1; i<=$#; i++)); do
  case "\${!i}" in
    --output)
      j=$((i + 1))
      out="\${!j}"
      ;;
    --data)
      j=$((i + 1))
      data="\${!j}"
      ;;
  esac
done
printf '%s\\n' "$*" > "\${HOME}/curl.args"
printf '%s\\n' "$data" > "\${HOME}/delete.body"
printf '{"ok":true,"deleted":[{"id":"record-a"},{"id":"record-aaaa"}]}\\n' > "$out"
printf '200\\napplication/json'
`,
  );
  await chmod(fakeCurl, 0o755);

  const configDir = join(home, ".config/cf-ddns-manager");
  const appDir = join(home, ".local/share/cf-ddns-manager");
  await mkdir(configDir, { recursive: true });
  await mkdir(appDir, { recursive: true });
  const configPath = join(configDir, "client.env");
  const installedScript = join(appDir, "ddns-client.sh");
  await writeFile(
    configPath,
    [
      "URL=https://worker.example/ddns/update",
      "TOKEN=client-secret",
      "DOMAIN=home.example.com",
      "HOST=nas",
      "TYPE=BOTH",
      "IPV4=",
      "IPV6=",
      "TTL=",
      "PROXIED=",
      "",
    ].join("\n"),
  );
  await chmod(configPath, 0o600);
  await writeFile(installedScript, "#!/usr/bin/env bash\n");
  await chmod(installedScript, 0o700);
  await writeFile(
    join(home, "crontab.current"),
    `*/5 * * * * ${installedScript} --config ${configPath} >> ${home}/.cache/cf-ddns-manager/client.log 2>&1 # cf-ddns-manager\n`,
  );

  const result = spawnSync("bash", [clientPath, "--uninstall"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(await readFile(join(home, "curl.args"), "utf8"), /--request DELETE/);
  assert.match(await readFile(join(home, "curl.args"), "utf8"), /User-Agent: cf-ddns-manager-client\/1\.0/);
  assert.match(await readFile(join(home, "curl.args"), "utf8"), /https:\/\/worker\.example\/api\/records/);
  const body = await readFile(join(home, "delete.body"), "utf8");
  assert.match(body, /"host":"nas"/);
  assert.match(body, /"type":"A"/);
  assert.match(body, /"type":"AAAA"/);
  assert.match(body, /"ignoreMissing":true/);
  assert.match(body, /"ignoreUnowned":true/);
  assert.doesNotMatch(await readFile(join(home, "crontab.installed"), "utf8"), /cf-ddns-manager/);
  await assert.rejects(stat(configPath), /ENOENT/);
  await assert.rejects(stat(installedScript), /ENOENT/);
});

test("client uninstall treats unowned remote records as local cleanup success", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCrontab = join(fakeBin, "crontab");
  await writeFile(
    fakeCrontab,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-l" ]]; then
  cat "\${HOME}/crontab.current" 2>/dev/null || exit 1
else
  cp "$1" "\${HOME}/crontab.installed"
fi
`,
  );
  await chmod(fakeCrontab, 0o755);

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--output" ]]; then
    j=$((i + 1))
    out="\${!j}"
  fi
done
printf '{"ok":false,"error":"record_not_owned","message":"nas.home.example.com AAAA is not owned by this DDNS token."}\\n' > "$out"
printf '403\\napplication/json'
`,
  );
  await chmod(fakeCurl, 0o755);

  const configDir = join(home, ".config/cf-ddns-manager");
  const appDir = join(home, ".local/share/cf-ddns-manager");
  await mkdir(configDir, { recursive: true });
  await mkdir(appDir, { recursive: true });
  const configPath = join(configDir, "client.env");
  const installedScript = join(appDir, "ddns-client.sh");
  await writeFile(
    configPath,
    [
      "URL=https://worker.example/ddns/update",
      "TOKEN=client-secret",
      "DOMAIN=home.example.com",
      "HOST=nas",
      "TYPE=AAAA",
      "IPV4=",
      "IPV6=",
      "TTL=",
      "PROXIED=",
      "",
    ].join("\n"),
  );
  await chmod(configPath, 0o600);
  await writeFile(installedScript, "#!/usr/bin/env bash\n");
  await chmod(installedScript, 0o700);
  await writeFile(
    join(home, "crontab.current"),
    `*/5 * * * * ${installedScript} --config ${configPath} >> ${home}/.cache/cf-ddns-manager/client.log 2>&1 # cf-ddns-manager\n`,
  );

  const result = spawnSync("bash", [clientPath, "--uninstall"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Remote DNS cleanup skipped/);
  assert.doesNotMatch(await readFile(join(home, "crontab.installed"), "utf8"), /cf-ddns-manager/);
  await assert.rejects(stat(configPath), /ENOENT/);
  await assert.rejects(stat(installedScript), /ENOENT/);
});

test("client explains common argument mistakes before calling curl", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(fakeCurl, "#!/usr/bin/env bash\necho curl-should-not-run >&2\nexit 99\n");
  await chmod(fakeCurl, 0o755);

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--manage-endpoint",
      "worker.example",
      "--ddns-token",
      "client-secret",
      "--ddns-suffix",
      "home.example.com",
      "--sub-domain",
      "nas.home.example.com",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--sub-domain should be only the node name/);
  assert.doesNotMatch(result.stderr, /curl-should-not-run/);
});

test("client defaults ddns suffix to manager endpoint hostname", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--output" ]]; then
    j=$((i + 1))
    out="\${!j}"
  fi
done
printf '%s\\n' "$*" > "$out"
printf '200\\napplication/json'
`,
  );
  await chmod(fakeCurl, 0o755);

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--manage-endpoint",
      "ddns.example.com",
      "--ddns-token",
      "client-token",
      "--sub-domain",
      "nas",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /domain=ddns\.example\.com/);
});

test("client sends and persists custom user agent", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCrontab = join(fakeBin, "crontab");
  await writeFile(
    fakeCrontab,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-l" ]]; then
  cat "\${HOME}/crontab.current" 2>/dev/null || exit 1
else
  cp "$1" "\${HOME}/crontab.installed"
fi
`,
  );
  await chmod(fakeCrontab, 0o755);

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
args="$*"
if [[ "$args" == *"api.ipify.org"* || "$args" == *"api6.ipify.org"* ]]; then
  exit 0
fi
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--output" ]]; then
    j=$((i + 1))
    out="\${!j}"
  fi
done
printf '%s\\n' "$args" > "\${HOME}/update.args"
printf '{"ok":true}\\n' > "$out"
printf '200\\napplication/json'
`,
  );
  await chmod(fakeCurl, 0o755);

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--install",
      "--manage-endpoint",
      "worker.example",
      "--ddns-token",
      "client-secret",
      "--user-agent",
      "cf-ddns-manager-client/custom-tag",
      "--ddns-suffix",
      "home.example.com",
      "--sub-domain",
      "nas",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(await readFile(join(home, "update.args"), "utf8"), /--user-agent cf-ddns-manager-client\/custom-tag/);
  const config = await readFile(join(home, ".config/cf-ddns-manager/client.env"), "utf8");
  assert.match(config, /^DDNS_USER_AGENT=cf-ddns-manager-client\/custom-tag$/m);
});

test("client auto-detects both public IP families without persisting detected values", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCrontab = join(fakeBin, "crontab");
  await writeFile(
    fakeCrontab,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-l" ]]; then
  cat "\${HOME}/crontab.current" 2>/dev/null || exit 1
else
  cp "$1" "\${HOME}/crontab.installed"
fi
`,
  );
  await chmod(fakeCrontab, 0o755);

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$args" == *"api.ipify.org"* ]]; then
  printf '198.51.100.7'
  exit 0
fi
if [[ "$args" == *"api6.ipify.org"* ]]; then
  printf '2001:db8::7'
  exit 0
fi
out=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--output" ]]; then
    j=$((i + 1))
    out="\${!j}"
  fi
done
printf '%s\\n' "$args" > "\${HOME}/update.args"
printf '{"ok":true}\\n' > "$out"
printf '200\\napplication/json'
`,
  );
  await chmod(fakeCurl, 0o755);

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--install",
      "--manage-endpoint",
      "worker.example",
      "--ddns-token",
      "client-secret",
      "--ddns-suffix",
      "home.example.com",
      "--sub-domain",
      "nas",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const updateArgs = await readFile(join(home, "update.args"), "utf8");
  assert.match(updateArgs, /ipv4=198\.51\.100\.7/);
  assert.match(updateArgs, /ipv6=2001:db8::7/);

  const config = await readFile(join(home, ".config/cf-ddns-manager/client.env"), "utf8");
  assert.match(config, /^IPV4=''$/m);
  assert.match(config, /^IPV6=''$/m);
});

test("client retries manager update over IPv4 when IPv6 route returns an HTML 403", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
ipv4="false"
args="$*"
for ((i=1; i<=$#; i++)); do
  case "\${!i}" in
    --output)
      j=$((i + 1))
      out="\${!j}"
      ;;
    --ipv4)
      ipv4="true"
      ;;
  esac
done
if [[ "$ipv4" == "true" ]]; then
  printf '%s\\n' "$args" > "\${HOME}/retry.args"
  printf '{"ok":true}\\n' > "$out"
  printf '200\\napplication/json'
else
  printf '<!doctype html><html><body>forbidden</body></html>\\n' > "$out"
  printf '403\\ntext/html'
fi
`,
  );
  await chmod(fakeCurl, 0o755);

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--manage-endpoint",
      "worker.example",
      "--ddns-token",
      "client-secret",
      "--ddns-suffix",
      "home.example.com",
      "--sub-domain",
      "nas",
      "--record-type",
      "A",
      "--ipv4",
      "198.51.100.8",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(await readFile(join(home, "retry.args"), "utf8"), /--ipv4/);
  assert.match(result.stdout, /"ok":true/);
});

test("client debug prints diagnostics without leaking token", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
args="$*"
if [[ "$args" == *"api.ipify.org"* ]]; then
  printf '198.51.100.9'
  exit 0
fi
if [[ "$args" == *"api6.ipify.org"* ]]; then
  printf '2001:db8::9'
  exit 0
fi
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--output" ]]; then
    j=$((i + 1))
    out="\${!j}"
  fi
done
printf '{"ok":true}\\n' > "$out"
printf '200\\napplication/json'
`,
  );
  await chmod(fakeCurl, 0o755);

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--debug",
      "--manage-endpoint",
      "worker.example",
      "--ddns-token",
      "client-secret",
      "--ddns-suffix",
      "home.example.com",
      "--sub-domain",
      "nas",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /debug: endpoint=https:\/\/worker\.example\/ddns\/update/);
  assert.match(result.stderr, /debug: detected ipv4=198\.51\.100\.9/);
  assert.match(result.stderr, /debug: detected ipv6=2001:db8::9/);
  assert.match(result.stderr, /debug: user_agent=cf-ddns-manager-client\/1\.0/);
  assert.match(result.stderr, /debug: http_status=200/);
  assert.match(result.stderr, /debug: token=\*\*\*REDACTED\*\*\*/);
  assert.doesNotMatch(result.stderr, /client-secret/);
});

test("client rejects manage endpoint with wrong project path before calling curl", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(fakeCurl, "#!/usr/bin/env bash\necho curl-should-not-run >&2\nexit 99\n");
  await chmod(fakeCurl, 0o755);

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--manage-endpoint",
      "https://example.com/not-ddns",
      "--ddns-token",
      "client-token",
      "--sub-domain",
      "nas",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /path must be \/ddns\/update or \/update/);
  assert.doesNotMatch(result.stderr, /curl-should-not-run/);
});

test("client reports html endpoint response without dumping page", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-ddns-manager-"));
  const fakeBin = join(home, "bin");
  await mkdir(fakeBin, { recursive: true });

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == "--output" ]]; then
    j=$((i + 1))
    out="\${!j}"
  fi
done
printf '<!doctype html><html><body>%s</body></html>\\n' "$(printf 'x%.0s' {1..400})" > "$out"
printf '200\\ntext/html'
`,
  );
  await chmod(fakeCurl, 0o755);

  const result = spawnSync(
    "bash",
    [
      clientPath,
      "--manage-endpoint",
      "example.com",
      "--ddns-token",
      "client-token",
      "--sub-domain",
      "nas",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /返回 HTML|returned HTML/i);
  assert.doesNotMatch(result.stdout + result.stderr, /<html>/);
});
