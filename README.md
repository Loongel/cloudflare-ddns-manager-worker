# Cloudflare DDNS Manager Worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Loongel/cloudflare-ddns-manager-worker)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Loongel/cloudflare-ddns-manager-worker?style=social)](https://github.com/Loongel/cloudflare-ddns-manager-worker/stargazers)

Cloudflare Worker DDNS 管理器。它把 DDNS 更新接口、Web Manager、Scoped Token、KV 记录归属和 Linux cron 客户端打包在一起，让客户端机器只持有 DDNS token，不持有 Cloudflare API Token。

适合家庭宽带、办公室出口、边缘节点、NAS、路由器和 VPS 的动态公网 IP 更新。

## What You Get

- 固定 DDNS API：`/ddns/update`，兼容 `/update`。
- Web Manager：查看记录、创建客户端 Token、启用/禁用/删除 Token、删除 DNS 记录。
- 两级鉴权：Admin Token 管理全部记录；Scoped Token 只能管理自己创建的记录。
- 多 DDNS 后缀：支持 `home.example.com`、`lab.example.net` 等多 Zone 配置。
- 自动识别公网 IP：客户端优先分别探测 IPv4/IPv6；未提交 IP 时 Worker 仍可读取 `CF-Connecting-IP` 兜底。
- IPv4/IPv6：支持 A、AAAA、AUTO、BOTH 更新。
- KV 记录归属：Token 和记录归属保存在 Cloudflare KV。
- 本地客户端：可安装到当前用户 crontab，每 5 分钟自动更新。
- 重复安装安全：同一 `# cf-ddns-manager` crontab 条目会被替换，不会重复累加。

## Quick Start

### 1. One-click deploy

点击 README 顶部的 **Deploy to Cloudflare**，或打开：

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/Loongel/cloudflare-ddns-manager-worker
```

Cloudflare 会基于仓库里的 `wrangler.jsonc` 创建 Worker，并自动 provision `DDNS_TOKENS` KV namespace。

也可以用在线命令从 GitHub 拉取项目并运行高级部署脚本。它是一条 shell 命令，README 中分行只是为了可读性。先替换里面的域名、Zone ID 和 Token：

```bash
WORKER_NAME=cf-ddns \
MANAGE_ENDPOINT=ddns.example.com \
DDNS_DOMAIN=home.example.com \
CF_ZONE_ID=your-cloudflare-zone-id \
CF_API_TOKEN=your-zone-dns-edit-token \
bash -c 'set -euo pipefail
tmp="$(mktemp -d)"
curl -fsSL https://github.com/Loongel/cloudflare-ddns-manager-worker/archive/refs/heads/main.tar.gz |
  tar -xz -C "$tmp" --strip-components=1
cd "$tmp"
npm install
npm run deploy:test'
```

部署时需要填写这些 secrets：

| Secret | 用途 |
| --- | --- |
| `CF_API_TOKEN` | Worker 调用 Cloudflare DNS API，建议只给目标 Zone 的 `DNS Edit` 权限 |
| `DDNS_ADMIN_TOKEN` | Web Manager 管理员登录 Token，可管理全部记录和客户端 Token |
| `DDNS_TOKEN` | 内置 Scoped Token，适合先给一台客户端使用 |

生成 `DDNS_ADMIN_TOKEN` 和 `DDNS_TOKEN`：

```bash
openssl rand -base64 32
```

### 2. Configure DDNS domains

部署前或部署后，在 Worker 的 variables 中修改 `DDNS_DOMAIN_CONFIGS`。单域名示例：

```json
[
  {
    "domain": "home.example.com",
    "zoneId": "your-cloudflare-zone-id",
    "ttl": 120,
    "proxied": false
  }
]
```

多域名 / 多 Zone 示例：

```json
[
  {
    "domain": "home.example.com",
    "zoneId": "zone-id-1",
    "ttl": 120,
    "proxied": false
  },
  {
    "domain": "lab.example.net",
    "zoneId": "zone-id-2",
    "ttl": 120,
    "proxied": false
  }
]
```

也支持 CSV 简写：

```text
home.example.com:ZONE_ID,lab.example.net:ZONE_ID
```

### 3. Verify deployment

访问健康检查：

```text
https://your-worker.workers.dev/health
```

访问 Web Manager：

```text
https://your-worker.workers.dev/
```

用 `DDNS_ADMIN_TOKEN` 登录后可以查看全部记录、创建新的 scoped token、管理 token 状态和删除 DNS 记录。用 scoped token 登录时，只能查看和管理该 token 自己创建的记录。

## Install Client

推荐在客户端机器上使用 scoped token。客户端只保存 DDNS token，只访问你自己的 Worker，不保存 Cloudflare API Token。

在线安装命令如下。它是一条 shell 命令，README 中分行只是为了可读性：

```bash
curl -fsSL \
  https://raw.githubusercontent.com/Loongel/cloudflare-ddns-manager-worker/main/scripts/ddns-client.sh |
  bash -s -- \
    --install \
    --manage-endpoint your-worker.workers.dev \
    --ddns-token 'your-scoped-token' \
    --user-agent 'cf-ddns-manager-client/your-private-tag' \
    --ddns-suffix home.example.com \
    --sub-domain nas
```

安装后路径：

```text
~/.local/share/cf-ddns-manager/ddns-client.sh
~/.config/cf-ddns-manager/client.env
~/.cache/cf-ddns-manager/client.log
```

默认 `--record-type auto` 会分别尝试 `curl -4` 和 `curl -6` 探测公网 IPv4/IPv6。
机器同时具备 IPv4 和 IPv6 出口时，会同时提交 A 和 AAAA；只有一种出口可用时，只提交可探测到的记录。
探测到的地址只用于当次更新，不会固化写入 `client.env`。

重复执行安装命令是安全的：配置会覆盖写入，crontab 中旧的 `# cf-ddns-manager` 条目会先移除再写入新条目。

`--user-agent` 会写入客户端配置，之后所有到 Manager Worker 的 DDNS 请求都会带上这个值。
它适合在 Cloudflare WAF / Bot 防护里做放行识别；它不是认证手段，真正认证仍然依赖 Bearer token。
如果不传，默认值是 `cf-ddns-manager-client/1.0`。

卸载：

```bash
~/.local/share/cf-ddns-manager/ddns-client.sh --uninstall
```

卸载会读取本地配置，先请求 Worker 删除当前客户端对应的 DNS 记录，再移除 crontab、客户端配置和本地脚本。记录不存在或不属于当前 token 时，会提示 skipped，但本地卸载仍会继续。

## Configuration

`wrangler.jsonc` 是一键部署入口使用的主配置。`wrangler.toml.example` 保留为手动部署参考。

### Variables

| Variable | 默认值 | 说明 |
| --- | --- | --- |
| `DDNS_DOMAIN_CONFIGS` | 示例 JSON | 允许更新的 DDNS 后缀和 Cloudflare Zone ID |
| `DEFAULT_TTL` | `120` | DNS 记录默认 TTL |
| `DEFAULT_PROXIED` | `false` | DNS 记录默认 Cloudflare proxy 状态 |

### Secrets

| Secret | 建议 |
| --- | --- |
| `CF_API_TOKEN` | Cloudflare API Token，权限只给目标 Zone 的 `Zone -> DNS -> Edit` |
| `DDNS_ADMIN_TOKEN` | 自行生成的高强度随机字符串，不是 Cloudflare Token |
| `DDNS_TOKEN` | 自行生成的 scoped client token，不是 Cloudflare Token |

Cloudflare API Token 获取方式：

1. 进入 Cloudflare Dashboard -> `My Profile` -> `API Tokens` -> `Create Token`。
2. 使用 `Edit zone DNS` 模板，或自定义 Token。
3. 权限至少包含 `Zone` -> `DNS` -> `Edit`。
4. 资源范围建议只选择需要 DDNS 的具体 Zone。
5. 将生成的 Token 写入 Worker secret `CF_API_TOKEN`。

本地开发可以复制模板：

```bash
cp .dev.vars.example .dev.vars
```

然后填写真实 secret，再运行：

```bash
npm run dev
```

## Cloudflare Security Rules

如果 `curl` 客户端请求被 Cloudflare 返回 `Just a moment...`、HTML 403 或 Bot/WAF challenge，可以给 DDNS API 加一条 WAF Skip 规则。
Cloudflare 官方参考： [Skip action](https://developers.cloudflare.com/waf/custom-rules/skip/) / [Skip options](https://developers.cloudflare.com/waf/custom-rules/skip/options/)。

推荐先生成一个只给本项目使用的 User-Agent 标签：

```bash
printf 'cf-ddns-manager-client/%s\n' "$(openssl rand -hex 12)"
```

然后安装客户端时指定：

```bash
--user-agent 'cf-ddns-manager-client/你的随机标签'
```

Cloudflare Dashboard 设置步骤：

1. 进入目标 Zone。
2. 打开 `Security` -> `WAF` -> `Custom rules`。
3. 新建规则，例如 `Allow DDNS Worker client`。
4. 使用表达式，替换域名和 User-Agent：

```text
(http.host eq "ddns.example.com" and http.user_agent eq "cf-ddns-manager-client/你的随机标签" and http.request.uri.path in {"/ddns/update" "/update" "/api/records" "/health"})
```

5. Action 选择 `Skip`。
6. Skip scope 勾选会影响 curl/API 的规则，例如 WAF Managed Rules、Rate Limiting Rules、Super Bot Fight Mode Rules。
7. 保存后在客户端运行 `--debug`，确认返回 `content_type=application/json`。

如果这个域名只给 DDNS Worker 使用，也可以把表达式简化为：

```text
(http.host eq "ddns.example.com" and http.user_agent eq "cf-ddns-manager-client/你的随机标签")
```

注意：Cloudflare Bot Fight Mode 不能通过 WAF custom rule 跳过；如果是它触发拦截，需要关闭 Bot Fight Mode、改用可配置 Skip 的 Super Bot Fight Mode，或用 Cloudflare 支持的 IP Access rule 先命中放行。

User-Agent 可以被伪造，所以不要把它当作密钥；Worker 的 `Authorization: Bearer ...` 仍然必须保留。

## Advanced Deploy

如果你希望部署后自动跑本地测试、创建 KV、绑定自定义域名、健康检查，并可选真实写入一条测试 DNS 记录，使用现有脚本：

```bash
cp cf-ddns-deploy.env.example cf-ddns-deploy.env
chmod 600 cf-ddns-deploy.env
```

编辑 `cf-ddns-deploy.env` 后运行：

```bash
npm run deploy:test
```

`cf-ddns-deploy.env` 里的 `DDNS_USER_AGENT` 会用于部署后的健康检查、真实链路测试，以及脚本输出的客户端安装命令。

脚本会执行：

- `npm test`
- Wrangler 登录或使用 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
- 自动创建或复用 `DDNS_TOKENS` KV namespace
- 部署 Worker
- 调用 `/health`
- 如果设置了 `TEST_HOST`，调用 `/ddns/update` 写入测试记录
- 输出可直接使用的客户端安装命令

保存部署结果和客户端密钥：

```bash
RESULT_FILE=.deploy-result.env npm run deploy:test
```

## Manual Deploy

手动部署可以参考 `wrangler.toml.example`：

```bash
cp wrangler.toml.example wrangler.toml
```

编辑 `wrangler.toml` 中的 `DDNS_DOMAIN_CONFIGS` 和 `DDNS_TOKENS` KV namespace ID，然后写入 secrets：

```bash
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put DDNS_ADMIN_TOKEN
npx wrangler secret put DDNS_TOKEN
```

部署：

```bash
npm install
npm run deploy
```

不要提交真实 `wrangler.toml`、`.dev.vars`、`cf-ddns-deploy.env` 或任何 secret。

## Client Commands

指定 IPv4：

```bash
~/.local/share/cf-ddns-manager/ddns-client.sh \
  --manage-endpoint your-worker.workers.dev \
  --ddns-token 'your-scoped-token' \
  --ddns-suffix home.example.com \
  --sub-domain router \
  --ipv4 203.0.113.10
```

指定 IPv6：

```bash
~/.local/share/cf-ddns-manager/ddns-client.sh \
  --manage-endpoint your-worker.workers.dev \
  --ddns-token 'your-scoped-token' \
  --ddns-suffix home.example.com \
  --sub-domain router \
  --record-type AAAA \
  --ipv6 2001:db8::10
```

查看帮助：

```bash
~/.local/share/cf-ddns-manager/ddns-client.sh --help
```

常用参数：

| Option | 说明 |
| --- | --- |
| `--manage-endpoint` | Worker 管理域名或更新接口，例如 `ddns.example.com` |
| `--ddns-token` | Admin token 或 scoped token |
| `--ddns-suffix` | DDNS 后缀，例如 `home.example.com` |
| `--sub-domain` | 主机短名，例如 `nas`，不要传完整域名 |
| `--record-type` | `auto`、`A`、`AAAA`、`both`，默认 `auto` |
| `--ipv4` / `--ipv6` | 显式指定 IP，跳过对应地址族的自动探测 |
| `--ttl` | 覆盖 DNS TTL |
| `--proxied` | 覆盖 Cloudflare proxy 开关 |
| `--user-agent` | 发往 Manager Worker 的 User-Agent，可用于 Cloudflare WAF 放行 |
| `--debug` | 打印 endpoint、IP 探测、HTTP 状态和响应摘要；不会打印 token |

## HTTP API

`GET /ddns/update` 或 `POST /ddns/update`

鉴权：

```http
Authorization: Bearer <DDNS_ADMIN_TOKEN 或 scoped token>
```

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `domain` | 是 | Worker 允许的 DDNS 服务后缀，例如 `home.example.com` |
| `host` | 是 | 主机短名，例如 `nas`，不要传完整域名 |
| `type` | 否 | `auto`、`A`、`AAAA`、`both`，默认 `auto` |
| `ipv4` | 否 | 显式 IPv4；客户端未提交时，Worker 可根据调用方 IP 推断 |
| `ipv6` | 否 | 显式 IPv6；客户端未提交时，Worker 可根据调用方 IP 推断 |
| `ttl` | 否 | 覆盖 DNS TTL |
| `proxied` | 否 | 覆盖 Cloudflare 代理开关 |

示例：

```bash
curl --get 'https://your-worker.workers.dev/ddns/update' \
  --user-agent 'cf-ddns-manager-client/your-private-tag' \
  -H 'Authorization: Bearer your-ddns-token' \
  --data-urlencode 'domain=home.example.com' \
  --data-urlencode 'host=nas'
```

成功响应：

```json
{
  "ok": true,
  "domain": "home.example.com",
  "host": "nas",
  "fqdn": "nas.home.example.com",
  "updates": [
    {
      "type": "A",
      "name": "nas.home.example.com",
      "content": "203.0.113.10",
      "action": "updated",
      "id": "cloudflare-dns-record-id"
    }
  ]
}
```

## Development

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

验证 Wrangler 打包但不上传。这里使用临时 secrets JSON，只用于 dry-run：

```bash
printf '%s\n' '{"CF_API_TOKEN":"x","DDNS_ADMIN_TOKEN":"admin","DDNS_TOKEN":"scoped"}' > /tmp/cf-ddns-secrets.json
npx wrangler deploy --dry-run --config wrangler.jsonc --secrets-file /tmp/cf-ddns-secrets.json
rm -f /tmp/cf-ddns-secrets.json
```

本地启动 Worker：

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

## Project Structure

```text
src/worker.js              Cloudflare Worker 服务端
scripts/ddns-client.sh     本地 DDNS 客户端和 cron 安装器
scripts/deploy-and-test.sh 高级部署和真实链路测试脚本
test/*.mjs                 Node 测试
wrangler.jsonc             一键部署使用的 Worker 配置
wrangler.toml.example      手动部署配置示例
.dev.vars.example          本地开发 secret 模板
cf-ddns-deploy.env.example 高级部署脚本 env 模板
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Loongel/cloudflare-ddns-manager-worker&type=Date)](https://www.star-history.com/#Loongel/cloudflare-ddns-manager-worker&Date)

## License

MIT
