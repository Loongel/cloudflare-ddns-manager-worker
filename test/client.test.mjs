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
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);

  const cron = await readFile(join(home, "crontab.installed"), "utf8");
  assert.match(cron, /^\*\/5 \* \* \* \* .*ddns-client\.sh --config .*client\.env >> .*client\.log 2>&1 # cf-ddns-manager$/m);
  assert.doesNotMatch(cron, /client-secret/);
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
