# 香港 ECS 部署操作清单

实例 `i-j6c06mdtwktzobo4vaxc` · 公网 IP `47.76.244.209` · 域名 `wzzsl.fun`
实际系统：**Alibaba Cloud Linux 4.0.6**（包管理器 `dnf`）

> 按顺序执行。每步都有验证命令，**上一步没通过就不要往下走**。
> 完整原理说明见同目录 [`README.md`](./README.md)。

## 当前进度（2026-09-16 实测）

| 步骤 | 状态 |
|---|---|
| 安装依赖 | ✅ Node 22.23.0 / npm 10.9.8 / git 2.47.3 / Nginx 1.30.4 / MariaDB 10.6.25 |
| 建库建账号 | ✅ `yijian`（utf8mb4 / utf8mb4_unicode_ci），已收紧为 `bind-address = 127.0.0.1` |
| 拉取代码并构建 | ✅ `/opt/yijian`，HEAD `a0d0492`，`dist/` 与 `server-dist/` 均已产出 |
| 建表 | ✅ 5 表 / 5 个 CHECK 约束 / 3 个外键，`status` 默认值 `'运输中'` |
| 环境变量 | ✅ `/etc/yijian/yijian.env`（权限 600） |
| systemd | ✅ `yijian.service`，`active` + `enabled` |
| Nginx（80） | ✅ 80 → 301 跳转 HTTPS；ACME 校验路径保留在 80 且不跳转 |
| 安全组 80/443 | ✅ 已放行（check-host.net 多节点验证） |
| **SSL 证书** | ✅ **Let's Encrypt 已签发**（CN=wzzsl.fun，有效期至 2026-12-15，acme.sh 自动续期） |
| **Nginx（443）** | ✅ TLSv1.2/1.3 + HTTP/2 反代 `127.0.0.1:3000` |
| 数据迁移 | ✅ 3 用户 / 6 会话 / 5 包裹 / 54 事件 / 3 验证码，中文无乱码，外键孤儿 0 |
| 数据一致性 | ✅ RDS 与 MariaDB 行数完全一致（3/6/5/54/3） |
| 端到端验证 | ✅ `https://wzzsl.fun/` 200；`/api/health` 正确；`/api/parcels` 401；外部抓取可读到首页 |
| 重打包 APK | ✅ 已产出，内嵌 `server.url = https://wzzsl.fun` |

**部署已完成，无待办阻塞项。**

**实测与原假设的差异（重要）**

- 系统是 **Alinux 4**，不是 Ubuntu。**不要用 SSH banner 的 OpenSSH 版本反推发行版** —— Alinux 4 同样是 OpenSSH 9.6，曾据此误判
- **`certbot` / `socat` 在 Alinux 源中不可用** → 证书方案用 **acme.sh + webroot 模式**
- MariaDB 默认 `character_set_server=latin1`（Linux 的 mysql CLI 默认 `character_set_client=latin1`，与 Windows 的 gbk 同类问题）→ 需在 `/etc/my.cnf.d/` 写入 utf8mb4 配置
- 导入 `schema.sql` **必须加 `--default-character-set=utf8mb4`**，否则中文默认值触发 `ERROR 1067`
- 跨库导入须**剔除 `/*!40103 ...*/` 版本门控注释**：MariaDB 会执行其中低于自身版本的语句，而 `SET SQL_NOTES=...` 是 MySQL 专有变量，会报 `ERROR 1193`
- **本实例无宝塔面板、firewalld 为 `inactive`**（前一实例两者相反）—— 环境更干净
- **数据是活的**：`wzzsl.fun` 仍指向最初的 `47.122.112.1`，那台服务器可能仍在写库，**切换前建议再同步一次**
- **Android SDK 可从腾讯云镜像安装**（`dl.google.com` 在本机被完全阻断）：
  `https://mirrors.cloud.tencent.com/AndroidSDK/`，详见 `.workbuddy-ai/memory/2026-09-16.md`

---

## 第 0 步：控制台准备

- [ ] 安全组放行入方向 **80** 与 **443**（`3000`、`3306` 不要对外开放）
  > **安全组与系统防火墙是两层，互不替代。** 本次 firewalld 早已放行 80/443，但安全组未放行，
  > 表现为外部多节点探测 **`Connection timed out`（丢包）**。若只是端口无监听，会返回 `refused`——据此可区分二者。
- [ ] SSH 登录服务器

```bash
# 首次：生成部署专用密钥，把公钥装入服务器（在控制台「远程连接」中执行 echo ... >> ~/.ssh/authorized_keys）
ssh-keygen -t ed25519 -f ~/.ssh/yijian_hk -N "" -C "yijian-deploy"
ssh -i ~/.ssh/yijian_hk root@47.76.244.209
```

- [ ] 确认系统版本，决定用 `dnf` 还是 `apt`

```bash
cat /etc/os-release
```

> 同时确认实例地域，用元数据服务（权威，不依赖 DNS）：
> ```bash
> curl -s http://100.100.100.200/latest/meta-data/region-id    # 应为 cn-hongkong
> ```

---

## 第 1 步：安装依赖

Alinux 4 / CentOS 系（**本次实际使用**）：

```bash
dnf install -y nginx mariadb-server git nodejs
systemctl enable --now nginx mariadb
```

> `nodejs` 装出来即 **22.23.0**，满足 Vite 8 / TypeScript 6 对 Node ≥ 22.12 的要求，**无需 NodeSource 等第三方源**。
> 注意本机若用 `dnf install nodejs` 之外的方式安装，须自行确认版本。

Ubuntu / Debian 系把 `dnf install -y` 换成 `apt install -y` 即可。

**验证**：

```bash
systemctl is-active nginx mariadb
```

两个都应输出 `active`。

---

## 第 2 步：建库与账号

```bash
mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS yijian
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'yijian'@'127.0.0.1' IDENTIFIED BY '换成强密码';
GRANT ALL PRIVILEGES ON yijian.* TO 'yijian'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

**验证**：

```bash
mysql -uyijian -p -h127.0.0.1 -e "SELECT 1" yijian
```

> 密码含 `!` `@` 等特殊字符时，写进 `MYSQL_URL` 需按 URL 编码（`!` → `%21`），代码会用 `decodeURIComponent` 还原。

---

## 第 3 步：拉代码并构建

```bash
mkdir -p /opt/yijian && cd /opt/yijian
git clone <你的仓库地址> .
git checkout codex/aliyun-mysql-deploy
npm ci
npm run build
```

**验证**：

```bash
ls dist/index.html server-dist/index.mjs
```

两个文件都应存在。

---

## 第 4 步：建表

```bash
mysql --default-character-set=utf8mb4 -uroot yijian < mysql/schema.sql
```

**验证**：

```bash
mysql --default-character-set=utf8mb4 -uroot yijian -e "SHOW TABLES"
```

应看到 5 张表：`yijian_users`、`yijian_sessions`、`yijian_otp_challenges`、`yijian_parcels`、`yijian_parcel_events`。

> `--default-character-set=utf8mb4` **不能省**。中文默认值（如 `status` 列的 `运输中`）在 gbk 客户端下会报 `ERROR 1067`。

---

## 第 5 步：写入环境变量

```bash
mkdir -p /etc/yijian
cat > /etc/yijian/yijian.env <<'EOF'
NODE_ENV=production
PORT=3000
APP_HOST=127.0.0.1
PUBLIC_ORIGIN=https://wzzsl.fun

STORAGE_PROVIDER=mysql
MYSQL_URL=mysql://yijian:换成强密码@127.0.0.1:3306/yijian
MYSQL_CONNECTION_LIMIT=8

EMAIL_PROVIDER=resend
RESEND_TOKEN=换成ResendToken
EMAIL_FROM=no-reply@wzzsl.cloud
EMAIL_SUBJECT=驿见邮箱验证码
AUTH_EXPOSE_DEMO_CODE=false

KUAIDI100_KEY=换成快递100Key
KUAIDI100_CUSTOMER=换成快递100Customer
KUAIDI100_TRACK_QUERY_URL=https://poll.kuaidi100.com/poll/query.do
EOF

chmod 0600 /etc/yijian/yijian.env
```

**注意三处易错点**：

1. `EMAIL_FROM` 用 `wzzsl.cloud`——它是 Resend 已验证的发件域名，**不要写成 `wzzsl.fun`**
2. `MYSQL_URL` 里的密码若含特殊字符需 URL 编码
3. `AUTH_EXPOSE_DEMO_CODE` 必须为 `false`，否则验证码会出现在接口响应里

---

## 第 6 步：启动服务

```bash
cd /opt/yijian
install -m 0644 deploy/aliyun/yijian.service /etc/systemd/system/yijian.service
systemctl daemon-reload
systemctl enable --now yijian
```

**验证**：

```bash
curl http://127.0.0.1:3000/api/health
```

期望输出：

```json
{"ok":true,"service":"yijian","storage":"mysql"}
```

`"storage":"mysql"` 说明数据库连接正常。若这里就报错，先看日志：

```bash
journalctl -u yijian -n 50 --no-pager
```

---

## 第 7 步：配置 Nginx（先只开 80）

```bash
mkdir -p /var/www/letsencrypt
cat > /etc/nginx/conf.d/wzzsl.fun.conf <<'EOF'
server {
    listen 80;
    server_name wzzsl.fun;

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

nginx -t && systemctl reload nginx
```

**验证**（此时还没切 DNS，用 `--resolve` 强制走本机）：

```bash
curl -s -H "Host: wzzsl.fun" http://127.0.0.1/api/health
```

应返回与第 6 步相同的 JSON。这说明 Nginx → Node 的链路通了。

> `X-Forwarded-Proto` 不可省略，`server/index.mts` 会读取该头判断协议。

---

## 第 8 步：签发 HTTPS 证书

```bash
curl https://get.acme.sh | sh -s email=<你的邮箱>
~/.acme.sh/acme.sh --issue -d wzzsl.fun --webroot /var/www/letsencrypt
```

**验证**：确认证书文件已生成

```bash
ls ~/.acme.sh/wzzsl.fun/
```

然后把 80 端口块改成跳转，并新增 443 块：

```bash
cat > /etc/nginx/conf.d/wzzsl.fun.conf <<'EOF'
server {
    listen 80;
    server_name wzzsl.fun;

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
EOF

mkdir -p /etc/nginx/ssl
~/.acme.sh/acme.sh --install-cert -d wzzsl.fun \
  --key-file       /etc/nginx/ssl/wzzsl.fun.key \
  --fullchain-file /etc/nginx/ssl/wzzsl.fun.crt \
  --reloadcmd      "systemctl reload nginx"

nginx -t && systemctl reload nginx
```

> Nginx 1.25.1 起 `listen 443 ssl http2;` 已废弃，改用 `listen 443 ssl;` 加独立 `http2 on;`。

---

## 第 9 步：切换 DNS

- [ ] 在 DNSPod 把 `wzzsl.fun` 的 A 记录从 `47.122.112.1` 改为 **`47.76.244.209`**
- [ ] 删除指向 `47.122.112.1` 的旧记录

**验证**（等 TTL 生效，最长 10 分钟）：

```bash
curl "https://dns.alidns.com/resolve?name=wzzsl.fun&type=A"
```

`data` 字段应为 `47.76.244.209`。

---

## 第 10 步：端到端验证

```bash
curl -I http://wzzsl.fun          # 期望 301 → https
curl -I https://wzzsl.fun         # 期望 200（不加 -k，验证证书链有效）
curl -i https://wzzsl.fun/api/auth/me   # 期望 401 + AUTH_REQUIRED
```

第 3 条返回 `401` 是**正确结果**——说明反代、HTTPS、鉴权链路都正常。

最后在手机浏览器打开 `https://wzzsl.fun`，确认页面能加载。

---

## 第 11 步：迁移数据

数据量很小（68 行），`mysqldump` 直接搬。

**在能连 RDS 的机器上导出**：

```bash
mysqldump --default-character-set=utf8mb4 \
  -h rm-cn-fjqyf4to0001g5o.rwlb.rds.aliyuncs.com -u wz -p \
  --single-transaction --set-gtid-purged=OFF \
  yijian > yijian-dump.sql
```

**上传到 ECS 后导入**：

```bash
mysql --default-character-set=utf8mb4 -uyijian -p yijian < yijian-dump.sql
```

**核对行数**（迁移前基线：2 用户 / 5 会话 / 5 包裹 / 54 事件）：

```bash
mysql --default-character-set=utf8mb4 -uyijian -p yijian -e "
SELECT 'users' t, COUNT(*) c FROM yijian_users
UNION ALL SELECT 'sessions', COUNT(*) FROM yijian_sessions
UNION ALL SELECT 'parcels',  COUNT(*) FROM yijian_parcels
UNION ALL SELECT 'events',   COUNT(*) FROM yijian_parcel_events"
```

> 迁移是一次性快照，之后两侧各自独立演进。

---

## 第 12 步：重新打包 App

`capacitor.config.ts` 已指向 `https://wzzsl.fun`，但 APK 内的配置是打包时固化的：

```bash
npx cap sync android
```

然后用 Android Studio 或 `./gradlew assembleRelease` 重新出包。

---

## 回滚方案

DNS 切回 `47.122.112.1` 即可（前提是旧服务器尚未停用）。**建议旧服务器保留至少 3 天**再下线。

---

## 常见故障对照

| 现象 | 排查方向 |
|---|---|
| `curl 127.0.0.1:3000/api/health` 失败 | `journalctl -u yijian -n 50`；检查 `MYSQL_URL` 密码是否需 URL 编码 |
| health 返回 `"storage":"local"` | `STORAGE_PROVIDER` 没生效，检查 `NODE_ENV=production` 与环境文件路径 |
| Nginx 502 | Node 没起来，或 `proxy_pass` 端口与 `PORT` 不一致 |
| 建表报 `ERROR 1067` | 漏了 `--default-character-set=utf8mb4` |
| App 白屏但浏览器正常 | 证书链不完整，检查 `ssl_certificate` 用的是 `fullchain` 而非单证书 |
| 域名解析不到新 IP | DNSPod 记录未保存，或本地 DNS 缓存；用 DoH 查询绕开缓存 |
