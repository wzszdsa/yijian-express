# 部署到中国香港 ECS（免 ICP 备案）

> **实施状态（2026-09-16）：部署已完成并全链路验证通过。**
> 实例 `i-j6c06mdtwktzobo4vaxc`（`47.76.244.209`，`cn-hongkong`）上已完成：依赖安装、建库建账号、
> 代码部署与构建、建表、systemd、Nginx 反代、Let's Encrypt 证书签发、443 配置、数据迁移、APK 打包。
>
> 验证结果：`https://wzzsl.fun/` 返回 200，`/api/health` 正确回报 `storage: mysql`，
> `http://` 自动 301 跳转 HTTPS，外部第三方抓取可正常读到首页；RDS 与本地 MariaDB 数据行数完全一致。
> 证书有效期至 **2026-12-15**，由 acme.sh 自动续期。
>
> 实测细节与踩坑记录见 `.workbuddy-ai/memory/2026-09-16.md`。

## 为什么是香港节点

ICP 备案约束的是**服务器接入环节**：域名解析到中国大陆节点时，未备案会被接入商阻断，80 与 443 端口同样受限。中国香港不属于工信部备案管辖范围，因此**域名无需备案即可正常解析访问**。

由此得出本方案的一条硬性前提：

> **App 会访问到的每一个地址都必须落在境外。**
> 只把前端放到香港、后端留在大陆是不成立的——`src/api.ts` 的 `VITE_API_BASE_URL` 默认为空，接口走同域相对路径，请求仍会发往大陆后端并被阻断。结果是 App 能从香港加载出页面，但登录、查快递全部失败。

因此本方案把**前端静态资源、Node 服务、数据库**全部部署在同一台香港 ECS 上，保持原有的单机形态。

## 域名分工（重要）

本项目使用两个域名，职责完全不同，**不要混用**：

| 域名 | 用途 | 需要的 DNS 记录 |
|---|---|---|
| `wzzsl.fun` | 站点与 App 的访问域名，指向本机 | **A 记录**（指向香港 ECS 公网 IP） |
| `wzzsl.cloud` | 仅用于 Resend 发送验证码邮件 | SPF / DKIM，**不需要 A 记录** |

因此 `wzzsl.cloud` 没有 A 记录属于**正常状态**，不代表故障。反过来，`wzzsl.fun` 必须有 A 记录且能通过 HTTPS 正常访问，否则 App 无法加载任何内容。

配置邮件时对应关系为：

```text
EMAIL_FROM=no-reply@wzzsl.cloud     ← 发件域名，需在 Resend 中完成域名验证
PUBLIC_ORIGIN=https://wzzsl.fun     ← 站点域名，需解析到本机
```

## 架构

```
App / 浏览器
     │  https://wzzsl.fun
     ▼
  Nginx  (443 / 80)
     │  proxy_pass
     ▼
  Node 服务  (127.0.0.1:3000)   ← 同时提供 dist/ 静态资源与 /api/*
     │  mysql://
     ▼
  MariaDB  (127.0.0.1:3306)
```

与大陆方案的区别只有三点：地域、无需备案、数据库自建。**应用代码零改动**（`VITE_API_BASE_URL` 保持为空，接口与前端同域）。

## 前置条件

- 一台阿里云**中国香港**地域的 ECS——本次实例为 `i-j6c06mdtwktzobo4vaxc`，公网 IP **`47.76.244.209`**
  （地域经实例元数据服务权威确认：`curl http://100.100.100.200/latest/meta-data/region-id` → `cn-hongkong`）
  > 注意：ECS 地域购买后不可更改，无法把大陆实例「改」成香港
- 域名 `wzzsl.fun` 的解析管理权限
- 服务器安全组放行 **80** 与 **443**（3300 与 3000 不需要对外，走本机回环）

### 实际环境（2026-09-15 实测，非推断）

| 项 | 实际值 |
|---|---|
| 操作系统 | **Alibaba Cloud Linux 4.0.6**（`ID=alinux`，包管理器 **`dnf`**） |
| 架构 | x86_64 |
| 资源 | 2 vCPU / 1670 MB 内存 / **4095 MB swap** / 根盘 40 G（30 G 可用） |
| 部署前已装组件 | **Node / npm / git / Nginx / MySQL 全部缺失**，需从零安装 |
| 系统防火墙 | firewalld `active`，已放行 `22/80/443/8888/21027/39000-40000` |
| SELinux | `Disabled` |
| 其他 | 机器上已装**宝塔面板**（无 nginx/mysql/php、无站点），本次**保留不动**，走手动部署 |

下文命令以本次实际环境为准。

> **不要用 SSH banner 的 OpenSSH 版本反推发行版。** Alinux 4 搭载 OpenSSH 9.6，与 Ubuntu 24.04 相同，曾据此误判为 Ubuntu。
> Ubuntu / Debian 系把 `dnf install -y` 换成 `apt install -y` 即可，但 **`certbot` / `socat` 在 Alinux 源中不可用**，证书须用 **acme.sh + webroot 模式**。

---

## 1. 系统准备

```bash
dnf install -y nginx mariadb-server git
systemctl enable --now nginx mariadb
```

## 2. 建库

```bash
cd /opt/yijian
mysql -uroot < mysql/schema.sql
```

> **字符集陷阱（必读）**：Windows 下 mysql 客户端默认 `character_set_client=gbk`，直接执行 `mysql/schema.sql` 会因中文默认值（如 `status` 列的 `运输中`）报 `ERROR 1067 Invalid default value for 'status'`。手工建表必须加 `--default-character-set=utf8mb4`。

创建应用专用账号（不要用 root 跑应用）：

```sql
CREATE USER 'yijian'@'127.0.0.1' IDENTIFIED BY '<强密码>';
GRANT ALL PRIVILEGES ON yijian.* TO 'yijian'@'127.0.0.1';
FLUSH PRIVILEGES;
```

## 3. 部署应用

```bash
mkdir -p /opt/yijian && cd /opt/yijian
# 拉取代码后：
npm ci
npm run build
```

`npm run build` 会依次执行 `tsc -b`、服务端类型检查、`vite build`（产出 `dist/`）与 `tsc -p tsconfig.server.json`（产出 `server-dist/`）。

## 4. 环境变量

写入 `/etc/yijian/yijian.env`，权限设为 `0600`：

```bash
mkdir -p /etc/yijian
touch /etc/yijian/yijian.env
chmod 0600 /etc/yijian/yijian.env
```

内容见文末「环境变量完整清单」。**不要把该文件提交到 Git**（`.gitignore` 已忽略 `.env.*`）。

## 5. systemd

```bash
install -m 0644 deploy/aliyun/yijian.service /etc/systemd/system/yijian.service
systemctl daemon-reload
systemctl enable --now yijian
curl http://127.0.0.1:3000/api/health
```

`deploy/aliyun/yijian.service` 模板与地域无关，可直接复用。健康检查应返回 `{"ok":true,"service":"yijian","storage":"mysql"}`。

## 6. Nginx 反向代理

`/etc/nginx/conf.d/wzzsl.fun.conf`：

```nginx
server {
    listen 80;
    server_name wzzsl.fun;

    # ACME 验证目录，证书签发前先保留
    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name wzzsl.fun;

    ssl_certificate     /etc/nginx/ssl/wzzsl.fun.crt;
    ssl_certificate_key /etc/nginx/ssl/wzzsl.fun.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> `X-Forwarded-Proto` 不可省略：`server/index.mts` 读取该头来判断请求协议。
>
> Nginx 1.25.1 起 `listen 443 ssl http2;` 写法已废弃，改为 `listen 443 ssl;` 加独立的 `http2 on;`。请按实际版本选择。

先只启用 80 端口的 server 块跑通，再签发证书、启用 443。

## 7. HTTPS 证书（Let's Encrypt）

香港节点可正常签发，无需备案。使用 acme.sh：

```bash
curl https://get.acme.sh | sh -s email=<你的邮箱>
mkdir -p /var/www/letsencrypt

~/.acme.sh/acme.sh --issue -d wzzsl.fun --webroot /var/www/letsencrypt
~/.acme.sh/acme.sh --install-cert -d wzzsl.fun \
  --key-file       /etc/nginx/ssl/wzzsl.fun.key \
  --fullchain-file /etc/nginx/ssl/wzzsl.fun.crt \
  --reloadcmd      "systemctl reload nginx"
```

acme.sh 会自动安装续期定时任务。可用 `~/.acme.sh/acme.sh --list` 确认。

## 8. 数据迁移

数据量很小（68 行），用 `mysqldump` 直接搬运即可。

**从大陆 RDS 导出**（在能连通 RDS 的机器上执行）：

```bash
mysqldump --default-character-set=utf8mb4 \
  -h <rds公网地址> -u <用户> -p \
  --single-transaction --set-gtid-purged=OFF \
  yijian > yijian-dump.sql
```

**导入香港 MariaDB**：

```bash
mysql --default-character-set=utf8mb4 -uyijian -p yijian < yijian-dump.sql
```

导入后核对行数（迁移前基线：2 用户 / 5 会话 / 5 包裹 / 54 事件 / 2 验证码）：

```sql
SELECT 'users', COUNT(*) FROM yijian_users
UNION ALL SELECT 'sessions', COUNT(*) FROM yijian_sessions
UNION ALL SELECT 'parcels', COUNT(*) FROM yijian_parcels
UNION ALL SELECT 'events', COUNT(*) FROM yijian_parcel_events;
```

> 迁移是一次性快照，之后两侧各自独立演进，不会自动同步。

## 9. 域名解析切换

在 DNSPod 把 `wzzsl.fun` 的 A 记录从 `47.122.112.1` 改为 **`47.76.244.209`**（香港 ECS 公网 IP），并删除旧记录。

验证解析已生效：

```bash
curl "https://dns.alidns.com/resolve?name=wzzsl.fun&type=A"
```

## 10. 验证清单

```bash
# 1. 服务本机可达
curl http://127.0.0.1:3000/api/health

# 2. 经 Nginx 的 HTTP 跳转
curl -I http://wzzsl.fun

# 3. 经 Nginx 的 HTTPS（含证书有效性，不加 -k）
curl -I https://wzzsl.fun

# 4. 接口经反代可达（未登录应返回 401 AUTH_REQUIRED）
curl -i https://wzzsl.fun/api/auth/me

# 5. 静态资源
curl -I https://wzzsl.fun/
```

第 4 步返回 `401` + `AUTH_REQUIRED` 是**正确结果**，说明反代链路与鉴权都正常工作。

---

## 环境变量完整清单

写入 `/etc/yijian/yijian.env`（`KEY=value`，每行一个，不要加引号）：

### 基础运行

| 变量 | 必填 | 说明 |
|---|---|---|
| `NODE_ENV` | 是 | 固定 `production`。生产环境下 `STORAGE_PROVIDER` 默认取 `mysql` |
| `PORT` | 是 | Node 监听端口，与 Nginx 反代一致，建议 `3000` |
| `APP_HOST` | 是 | 建议 `127.0.0.1`（只接受本机 Nginx 转发，不直接对外） |
| `PUBLIC_ORIGIN` | 是 | `https://wzzsl.fun`，影响 URL 解析与回调地址 |
| `WEB_ROOT` | 否 | 静态资源目录，默认 `<cwd>/dist` |
| `MAX_BODY_BYTES` | 否 | 请求体上限，默认 1048576（1MB） |
| `ENV_FILE` | 否 | 环境文件路径，默认 `.env`；systemd 下由 `EnvironmentFile` 注入，无需设置 |

### 存储

| 变量 | 必填 | 说明 |
|---|---|---|
| `STORAGE_PROVIDER` | 是 | `mysql`（自建 MariaDB 场景）或 `local`（JSON 文件，仅调试） |
| `MYSQL_URL` | 是 | `mysql://yijian:<密码>@127.0.0.1:3306/yijian`。密码含特殊字符需按 URL 编码（如 `!` → `%21`） |
| `MYSQL_CONNECTION_LIMIT` | 否 | 连接池上限，默认 `4` |
| `MYSQL_SSL` | 否 | 本机回环连接无需 TLS，留空 |

> `DATABASE_URL` 是 `MYSQL_URL` 的别名，二者取其一。

### 邮件验证码

| 变量 | 必填 | 说明 |
|---|---|---|
| `EMAIL_PROVIDER` | 是 | `resend`；本地调试可用 `console`（验证码打到日志） |
| `RESEND_TOKEN` | 是 | Resend API Token |
| `EMAIL_FROM` | 是 | 发件人地址，域名用 `wzzsl.cloud`——它是 Resend 中已验证的发件域名，**与站点域名 `wzzsl.fun` 不同**，不要写成站点域名 |
| `EMAIL_SUBJECT` | 否 | 默认「驿见邮箱验证码」 |
| `AUTH_EXPOSE_DEMO_CODE` | 否 | 仅 `EMAIL_PROVIDER=console` 时生效，调试用，**生产必须不设或设为 false** |

### 快递100

| 变量 | 必填 | 说明 |
|---|---|---|
| `KUAIDI100_KEY` | 是 | 授权 key |
| `KUAIDI100_CUSTOMER` | 是 | 客户编号 |
| `KUAIDI100_TRACK_QUERY_URL` | 是 | `https://poll.kuaidi100.com/poll/query.do` |
| `KUAIDI100_RESULTV2` | 否 | 行政区/坐标解析开关。**合法值仅 `1` / `4` / `8`**（`4` = 返回 `areaCenter` 坐标，本项目用此值）；填其他值上游不会返回坐标，地图将始终提示「承运商未返回坐标」 |

### 示例（请替换所有占位符）

```text
NODE_ENV=production
PORT=3000
APP_HOST=127.0.0.1
PUBLIC_ORIGIN=https://wzzsl.fun

STORAGE_PROVIDER=mysql
MYSQL_URL=mysql://yijian:<密码>@127.0.0.1:3306/yijian
MYSQL_CONNECTION_LIMIT=4

EMAIL_PROVIDER=resend
RESEND_TOKEN=<token>
EMAIL_FROM=no-reply@wzzsl.cloud

KUAIDI100_KEY=<key>
KUAIDI100_CUSTOMER=<customer>
KUAIDI100_TRACK_QUERY_URL=https://poll.kuaidi100.com/poll/query.do
```

## 与手机 App 的关系

`capacitor.config.ts` 的 `server.url` 已指向 `https://wzzsl.fun`，且 `cleartext: false` 要求 HTTPS。因此**第 7 步的证书是 App 可用的必要条件**——没有有效证书，App 的 WebView 会拒绝加载。

改动 `capacitor.config.ts` 后需要重新同步与打包：

```bash
npx cap sync android
```

`android/app/src/main/assets/capacitor.config.json` 由该命令生成，不要手工编辑。
