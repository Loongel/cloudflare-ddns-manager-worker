# Cloudflare DDNS Manager Worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Loongel/cloudflare-ddns-manager-worker)

Cloudflare Worker DDNS 管理器，内置 Web Manager、KV-backed scoped token registry 和 cron-friendly 本地客户端。客户端只调用你自己的 Worker，不持有 Cloudflare API Token，适合家庭宽带、办公室出口、边缘节点和 VPS 动态公网 IP 更新。

## Features

- 固定 DDNS API：`/ddns/update`，兼容 `/update`。
- Web Manager：查看记录、创建客户端 Token、启用/禁用/删除 Token、删除 DNS 记录。
- 两级鉴权：Admin Token 管理全部记录；Scoped Token 只能管理自己创建的记录。
- 多 DDNS 后缀：支持 `home.example.com`、`lab.example.net` 等多 Zone 配置。
- 自动识别调用方公网 IP：未提交 IP 时读取 `CF-Connecting-IP`。
- IPv4/IPv6：支持 A、AAAA、AUTO、BOTH 更新。
- KV 记录归属：Token 和记录归属保存在 Cloudflare KV。
- 本地客户端：可安装到当前用户 crontab，每 5 分钟自动更新。

## Quick Start

### 1. One-click deploy

点击 README 顶部的 **Deploy to Cloudflare**，或打开：

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/Loongel/cloudflare-ddns-manager-worker
```

Cloudflare 会基于仓库里的 `wrangler.jsonc` 创建 Worker，并自动 provision `DDNS_TOKENS` KV namespace。

也可以用一行命令从 GitHub 在线拉取项目并运行高级部署脚本。先替换里面的域名、Zone ID 和 Token：

```bash
WORKER_NAME=cf-ddns MANAGE_ENDPOINT=ddns.example.com DDNS_DOMAIN=home.example.com CF_ZONE_ID=your-cloudflare-zone-id CF_API_TOKEN=your-zone-dns-edit-token bash -c 'set -euo pipefail; tmp="$(mktemp -d)"; curl -fsSL https://github.com/Loongel/cloudflare-ddns-manager-worker/archive/refs/heads/main.tar.gz | tar -xz -C "$tmp" --strip-components=1; cd "$tmp"; npm install; npm run deploy:test'
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

## Client Installation

推荐在客户端机器上使用 scoped token。客户端只保存 DDNS token，只访问你自己的 Worker，不保存 Cloudflare API Token。

在线一行安装，先替换 Worker 域名、Token、DDNS 后缀和节点名：

```bash
curl -fsSL https://raw.githubusercontent.com/Loongel/cloudflare-ddns-manager-worker/main/scripts/ddns-client.sh | bash -s -- --install --manage-endpoint your-worker.workers.dev --ddns-token 'your-scoped-token' --ddns-suffix home.example.com --sub-domain nas
```

安装脚本会把客户端固定保存到：

```text
~/.local/share/cf-ddns-manager/ddns-client.sh
```

crontab 会引用这个固定路径，不会引用你执行命令时的当前目录或临时脚本路径。

安装到当前用户 crontab：

```bash
./scripts/ddns-client.sh --install \
  --manage-endpoint your-worker.workers.dev \
  --ddns-token 'your-scoped-token' \
  --ddns-suffix home.example.com \
  --sub-domain nas
```

如果 `--ddns-suffix` 和管理域名相同，可以省略。未指定 `--sub-domain` 时，客户端默认使用本机短 hostname。

指定 IPv4：

```bash
./scripts/ddns-client.sh \
  --manage-endpoint your-worker.workers.dev \
  --ddns-token 'your-scoped-token' \
  --ddns-suffix home.example.com \
  --sub-domain router \
  --ipv4 203.0.113.10
```

指定 IPv6：

```bash
./scripts/ddns-client.sh \
  --manage-endpoint your-worker.workers.dev \
  --ddns-token 'your-scoped-token' \
  --ddns-suffix home.example.com \
  --sub-domain router \
  --record-type AAAA \
  --ipv6 2001:db8::10
```

卸载当前用户 crontab：

```bash
./scripts/ddns-client.sh --uninstall
```

卸载会读取本地配置，先请求 Worker 删除当前客户端对应的 DNS 记录，再移除 crontab、客户端配置和 `~/.local/share/cf-ddns-manager/ddns-client.sh`。如果远端删除失败，脚本会提示 warning，但仍会继续清理本地安装。

配置文件：

```text
~/.config/cf-ddns-manager/client.env
```

日志文件：

```text
~/.cache/cf-ddns-manager/client.log
```

查看帮助：

```bash
./scripts/ddns-client.sh --help
```

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
| `ipv4` | 否 | 显式 IPv4，不传则 Worker 根据调用方 IP 推断 |
| `ipv6` | 否 | 显式 IPv6，不传则 Worker 根据调用方 IP 推断 |
| `ttl` | 否 | 覆盖 DNS TTL |
| `proxied` | 否 | 覆盖 Cloudflare 代理开关 |

示例：

```bash
curl --get 'https://your-worker.workers.dev/ddns/update' \
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

## License

MIT
