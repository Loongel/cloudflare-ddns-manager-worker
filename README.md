# Cloudflare DDNS Manager Worker

Cloudflare Worker DDNS 服务，带网页管理器和轻量本地客户端。客户端只调用你自己的 Worker，不持有 Cloudflare API Token，适合家庭、办公室、边缘节点和 VPS 的动态公网 IP 更新。

## 功能

- 固定更新接口：`/ddns/update`，兼容 `/update`。
- 网页管理器：查看记录、创建客户端 Token、启用/禁用/删除 Token、删除 DNS 记录。
- 两级 Token：Admin Token 管理全部记录；Scoped Token 只能管理自己创建的记录。
- 支持多个 DDNS 后缀，例如 `home.example.com`、`lab.example.net`。
- 未提交 IP 时，从 `CF-Connecting-IP` 自动识别客户端公网 IP。
- 支持显式提交 IPv4/IPv6，更新 A/AAAA 记录。
- 本地客户端可安装到当前用户 crontab，每 5 分钟自动更新。
- 客户端会校验 endpoint 路径，HTML/非 JSON 响应不会刷屏。

## 文件结构

```text
src/worker.js              Cloudflare Worker 服务端
scripts/ddns-client.sh     本地 DDNS 客户端和 cron 安装器
scripts/deploy-and-test.sh 一键部署和真实链路测试脚本
test/*.mjs                 Node 测试
wrangler.toml.example      Wrangler 配置示例
package.json               npm 脚本
```

## 一键部署和测试

推荐先用脚本完成部署和端到端测试。脚本会运行本地测试、部署 Worker、调用 `/health`，再创建或更新一个测试 DNS 记录。

创建本地 env 文件，不要提交：

```bash
cat > cf-ddns-deploy.env <<'EOF'
WORKER_NAME=cf-ddns
MANAGE_ENDPOINT=ddns.example.com

# 可 DDNS 的默认后缀；不写时默认使用 MANAGE_ENDPOINT。
DDNS_DOMAIN=home.example.com

# 简单模式：只配置一个可 DDNS 的后缀。
CF_ZONE_ID=your-cloudflare-zone-id

# 多后缀模式可改用完整服务端配置；设置后 CF_ZONE_ID 可省略。
# DDNS_DOMAIN_CONFIGS=[{"domain":"home.example.com","zoneId":"zone-id-1","ttl":120,"proxied":false},{"domain":"lab.example.net","zoneId":"zone-id-2","ttl":120,"proxied":false}]

# 可选：只在你明确要写入这个节点时填写。留空则只部署和健康检查，不写 DNS 记录。
# TEST_HOST=your-node-name

# Worker 运行时调用 Cloudflare DNS API 的 Secret，只放服务端。
CF_API_TOKEN=your-zone-dns-edit-token

# Admin token：可管理所有记录，并可在网页 Manager 中创建 scoped token。
# 留空不写时部署脚本会自动生成并写入 Worker。
# DDNS_ADMIN_TOKEN=your-admin-token

# Scoped token：只能管理自己创建的记录，适合放到客户端机器。
# 留空不写时部署脚本会自动生成并写入 Worker。
# DDNS_TOKEN=your-scoped-token

# Scoped token 和记录归属关系保存在 Cloudflare KV；留空时部署脚本会自动创建。
# DDNS_TOKENS_KV_ID=your-kv-namespace-id

# 非交互部署可选；没有这两项时脚本会尝试 wrangler login。
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-workers-deploy-token
EOF
chmod 600 cf-ddns-deploy.env
```

执行：

```bash
npm run deploy:test
```

成功后脚本会输出一条可直接执行的客户端安装命令，形如：

```bash
./scripts/ddns-client.sh --install \
  --manage-endpoint 'ddns.example.com' \
  --ddns-token 'your-scoped-token' \
  --sub-domain 'YOUR_NODE_NAME'
```

如果希望额外保存部署结果和客户端密钥，可以这样运行：

```bash
RESULT_FILE=.deploy-result.env npm run deploy:test
```

Token 权限建议：

- `CF_API_TOKEN`：目标 Zone 的 `DNS Edit`，只给对应 Zone。
- `CLOUDFLARE_API_TOKEN`：用于 Wrangler 部署 Worker 和创建 KV，至少需要当前 Account 的 Workers 脚本编辑权限和 KV 编辑权限。

配置关系：

- 客户端命令里的 `--ddns-token` 可以使用 Admin token 或 Scoped token。
- Admin token 可管理所有记录，Scoped token 只能管理自己创建的记录。
- 两类 token 不填时由部署脚本自动生成并写入 Worker；脚本会分别输出安装命令和用途说明。
- 后续新增 Scoped token 可登录网页 Manager，用 Admin token 创建。
- 可 DDNS 的域名后缀由 Worker 变量 `DDNS_DOMAIN_CONFIGS` 控制；增删域名后重新运行 `npm run deploy:test` 即可更新服务端配置。
- 客户端只持有 `--ddns-token`，不持有 `CF_API_TOKEN`。
- `TEST_HOST` 只用于部署后真实写入一条节点记录；没有明确节点名时不要设置它。

## 网页管理器

部署后访问 `https://MANAGE_ENDPOINT/` 可以打开网页管理器。

Admin Token 登录后可以查看全部记录、管理客户端 Token、按需显示 Token 值、删除 DNS 记录。Scoped Token 登录后只能查看和管理该 Token 自己创建的记录。

环境变量里的 Admin Token 和内置 Scoped Token 会显示在 Token 列表里，但不能在网页里禁用或删除；网页新建的 Scoped Token 支持启用、禁用和删除。

## 手动 Worker 配置

复制配置示例：

```bash
cp wrangler.toml.example wrangler.toml
```

编辑 `wrangler.toml` 里的 `DDNS_DOMAIN_CONFIGS`。推荐 JSON 格式：

```toml
[vars]
DDNS_DOMAIN_CONFIGS = """
[
  {
    "domain": "home.example.com",
    "zoneId": "your-cloudflare-zone-id",
    "ttl": 120,
    "proxied": false
  },
  {
    "domain": "lab.example.net",
    "zoneId": "another-zone-id",
    "ttl": 120,
    "proxied": false
  }
]
"""
DEFAULT_TTL = "120"
DEFAULT_PROXIED = "false"
```

也支持 CSV 简写：

```toml
DDNS_DOMAIN_CONFIGS = "home.example.com:ZONE_ID,lab.example.net:ZONE_ID"
```

设置 secret：

```bash
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put DDNS_ADMIN_TOKEN
npx wrangler secret put DDNS_TOKEN
```

手动部署还需要创建 KV namespace，并在 `wrangler.toml` 里绑定为 `DDNS_TOKENS`。

部署：

```bash
npm install
npm run deploy
```

## Cloudflare API Token 获取方式

在 Cloudflare Dashboard 中创建 API Token：

1. 进入 `My Profile` -> `API Tokens` -> `Create Token`。
2. 可使用 `Edit zone DNS` 模板，或自定义 Token。
3. 权限至少包含 `Zone` -> `DNS` -> `Edit`。
4. 资源范围建议只选择需要 DDNS 的具体 Zone。
5. 保存生成的 Token，并通过 `npx wrangler secret put CF_API_TOKEN` 写入 Worker secret。

`DDNS_ADMIN_TOKEN` 和 `DDNS_TOKEN` 是你自己生成的客户端调用密钥，不是 Cloudflare Token。可以用下面命令生成：

```bash
openssl rand -base64 32
```

## 本地客户端使用

首次安装到当前用户 crontab：

```bash
./scripts/ddns-client.sh --install \
  --manage-endpoint ddns.example.com \
  --ddns-token 'your-scoped-token'
```

上面的命令会默认使用本机短 hostname。例如主机名是 `nas`，最终会更新：

```text
nas.home.example.com
```

指定主机短名：

```bash
./scripts/ddns-client.sh --install \
  --manage-endpoint ddns.example.com \
  --ddns-token 'your-scoped-token' \
  --sub-domain router
```

指定 IPv4 或 IPv6：

```bash
./scripts/ddns-client.sh \
  --manage-endpoint ddns.example.com \
  --ddns-token 'your-scoped-token' \
  --ddns-suffix home.example.com \
  --sub-domain router \
  --ipv4 203.0.113.10
```

```bash
./scripts/ddns-client.sh \
  --manage-endpoint ddns.example.com \
  --ddns-token 'your-scoped-token' \
  --ddns-suffix home.example.com \
  --sub-domain router \
  --record-type AAAA \
  --ipv6 2001:db8::10
```

常见填写错误会在本地直接提示，例如 Manager endpoint 为空、子域名写成完整域名、记录类型非法、TTL 非正整数、IPv4/IPv6 格式明显错误等。旧参数 `--url`、`--token`、`--domain`、`--host` 仍然兼容。

客户端配置写入：

```text
~/.config/cf-ddns-manager/client.env
```

日志写入：

```text
~/.cache/cf-ddns-manager/client.log
```

卸载当前用户 crontab：

```bash
./scripts/ddns-client.sh --uninstall
```

查看客户端帮助：

```bash
./scripts/ddns-client.sh --help
```

## HTTP API

`GET /ddns/update` 或 `POST /ddns/update`

鉴权：

```http
Authorization: Bearer <DDNS_ADMIN_TOKEN 或 scoped token>
```

这里的 Bearer token 可以是 `DDNS_ADMIN_TOKEN` 或某个 scoped token。

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
  -H 'Authorization: Bearer your-ddns-secret' \
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

## 本地测试

不需要真实 Cloudflare Token：

```bash
npm test
```

验证 Wrangler 打包但不上传：

```bash
cp wrangler.toml.example wrangler.toml
npx wrangler deploy --dry-run
```

本地启动 Worker：

```bash
cp wrangler.toml.example wrangler.toml
npx wrangler dev
```

本地开发可以在 `.dev.vars` 放测试 secret：

```text
CF_API_TOKEN=replace-with-token
DDNS_ADMIN_TOKEN=replace-with-admin-token
DDNS_TOKEN=replace-with-scoped-token
```

不要提交 `.dev.vars` 或真实 `wrangler.toml` secret。

## License

MIT
