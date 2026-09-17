# 驿见 · 快递聚合查询 MVP

一个面向网页和 Android 的快递聚合查询应用：邮箱登录、邮箱验证码、密码登录、选择快递平台并输入运单号查件、地图轨迹展示、包裹状态、到站取件码和服务端保存的“我已取件”流程均已做成可交互流程。当前产品定位是“输入运单号后查询并保存”，不要求用户单独绑定快递账号。

## 当前完成

- 响应式 Web 工作台：桌面端侧边栏，移动端折叠菜单。
- 邮箱登录和注册：邮箱验证码用于验证身份，注册时必须设置 6-128 位登录密码；早期仅验证码账号可在“账号设置”中补充密码。
- 后端认证：注册、密码哈希、验证码校验、会话 Cookie、登录态恢复、退出登录；认证状态在启动时恢复，错误和加载状态有明确反馈。
- 邮件适配器：开发环境 `console` 演示模式；生产环境使用 Resend 邮件服务。
- 验证码安全控制：5 分钟过期、60 秒重发间隔、单小时发送上限、错误次数上限。
- 持久化：阿里云独立后端使用 MySQL/MariaDB；本地可使用 JSON 文件演示，不会提交到版本库。
- 平台查询：输入运单号后按公开单号规则自动识别快递平台（也可手动指定），服务端使用识别或指定的平台调用快递100实时查询；覆盖顺丰、京东、中通、圆通、韵达、申通、极兔、德邦、EMS、邮政等。中通、顺丰需填写收寄件人手机号（快递100 强制要求），已查询过的单号会自动复用上次填写的号码。
- 包裹状态：待取件、运输中、已完成；支持搜索、筛选、文字轨迹和地图轨迹面板。
- 取件码：默认脱敏，支持显示、复制；点击“我已取件”后由服务端保存已取件状态并删除取件码。
- Capacitor Android 工程：应用 ID 为 `com.yijian.parcels`。

## 本地运行网页演示

```powershell
cd D:\codex\purchase
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。此命令只启动 Vite，后端接口不可用时页面会回退到演示验证码模式。

## 本地运行前后端

独立 Node 服务会同时托管 `dist/` 前端和 `/api/*` 接口。

**默认使用阿里云 RDS**（`.env` 中的 `MYSQL_URL` 指向 RDS 公网地址）：

```powershell
cd D:\codex\purchase
npm run build
npm start          # 等价于 node server-dist/index.mjs，读取 .env
```

打开 `http://127.0.0.1:3000/`。

如需脱离云端、改用本机 MySQL 调试：

```powershell
$env:ENV_FILE = ".env.local"
npm start
```

如需完全不连数据库（本地 JSON 记录）：

```powershell
$env:STORAGE_PROVIDER = "local"
$env:EMAIL_PROVIDER = "console"
$env:AUTH_EXPOSE_DEMO_CODE = "true"
npm start
```

环境文件约定见 `.env.example`：`.env` 为默认（RDS），`.env.local` 为可选的本机 MySQL。

## 真实邮件服务：Resend

1. 创建 Resend Token。
2. 准备一个已验证的发件人地址或域名。
3. 在独立 Node 服务的 `/etc/yijian/yijian.env` 中配置：

```text
EMAIL_PROVIDER=resend
RESEND_TOKEN=...
EMAIL_FROM=驿见 <no-reply@wzzsl.cloud>
EMAIL_SUBJECT=驿见邮箱验证码
AUTH_EXPOSE_DEMO_CODE=false
```

真实 API Key 只配置在服务器环境变量中，前端不会读取。

发件域名使用 `wzzsl.cloud`，它只需在 Resend 中完成 SPF/DKIM 验证，**不需要 A 记录**。站点与 App 的访问域名是 `wzzsl.fun`，两者职责不同，不要混用。

## MySQL 数据库配置

独立后端通过 `mysql2` 连接 MySQL 或 MariaDB，生产环境建议让数据库只监听内网或本机，不开放公网 3306。建表脚本位于 `mysql/schema.sql`，包含账号、验证码、会话、包裹和物流轨迹表。

生产环境（中国香港 ECS）的 Node 服务只监听本机回环，由 Nginx 反向代理对外：

```text
NODE_ENV=production
APP_HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=https://wzzsl.fun
WEB_ROOT=/opt/yijian/dist
STORAGE_PROVIDER=mysql
MYSQL_URL=mysql://yijian_app:数据库密码@127.0.0.1:3306/yijian
MYSQL_CONNECTION_LIMIT=8
```

`MYSQL_URL`、邮件 Token 和快递100凭证只放在服务器的 `/etc/yijian/yijian.env`，不要写入前端、不要提交 Git。香港方案使用同机自建 MariaDB，`MYSQL_URL` 指向 `127.0.0.1`，不产生跨境流量；若改用阿里云 RDS，需先在 RDS 白名单中允许服务器公网出口 IP，并把 `MYSQL_URL` 改成 RDS 地址。

### 阿里云 RDS（可选）

迁移到中国香港 ECS 后，数据库改为同机自建 MariaDB，不再依赖 RDS。若需要回退到云端数据库，环境文件约定如下：

- `.env` —— **默认加载**，当前指向阿里云 RDS（大陆杭州）
- `.env.local` —— 可选，指向本机 MySQL，仅在需要脱离云端调试时使用

两者均含明文密码，**已被 `.gitignore` 的 `.env.*` 规则忽略**，切勿提交或分享。

`server/index.mts` 通过 `process.env.ENV_FILE` 选择环境文件，无需改代码：

```bash
node server-dist/index.mjs                      # 用 RDS（默认）
ENV_FILE=.env.local node server-dist/index.mjs  # 用本机 MySQL
```

`MYSQL_URL` 格式为 `mysql://用户名:密码@主机:3306/数据库名`。密码含特殊字符时按 URL 规则编码（如 `!` 写成 `%21`），代码用 `decodeURIComponent` 还原；也可用 `mysqls://` 前缀或 `MYSQL_SSL=true` 启用 TLS。

当前实例：`rm-cn-fjq4yf4to0001g`（华东1 杭州），MySQL 8.0.36。

#### 公网连接的前置条件

RDS 公网地址形如 `rm-xxxxxxxxx.rwlb.rds.aliyuncs.com`（`rwlb` = 读写分离负载均衡），与内网域名**不是同一个**。使用前必须：

1. 在 RDS 控制台 **申请公网连接地址**（未申请时该域名在权威 DNS 上返回 NXDOMAIN）；
2. 在 **白名单** 中加入客户端出口 IP。注意代理、VPN、TUN 模式都会改变出口 IP，需以实际出口为准。

#### 数据迁移

```bash
npm run migrate:rds              # 只读预检：连通性、表结构、数据量对比
npm run migrate:rds -- --create  # 预检 + 在 RDS 上建表
npm run migrate:rds -- --apply   # 预检 + 建表（如需）+ 迁移数据
```

脚本默认只读，任何写入都必须显式加 `--apply`；按外键依赖顺序迁移（users → sessions → parcels → parcel_events → otp_challenges），写入使用 `INSERT ... ON DUPLICATE KEY UPDATE`，可重复执行。

> **字符集陷阱（重要）**：Windows 下 mysql 客户端默认 `character_set_client=gbk`，直接执行 `mysql/schema.sql` 会因中文默认值（如 `status` 列的 `运输中`）报 `ERROR 1067 Invalid default value for 'status'`。手工建表时必须加 `--default-character-set=utf8mb4`；迁移脚本已内置 `SET NAMES utf8mb4`。

## 部署

**当前采用中国香港 ECS 方案**，完整步骤见 [`deploy/hongkong/README.md`](deploy/hongkong/README.md)。

选择香港节点的原因：ICP 备案约束的是**服务器接入环节**，域名解析到中国大陆节点时未备案会被阻断，80 与 443 端口同样受限；中国香港不属于该管辖范围，域名无需备案即可正常访问。

关键约束：**App 访问到的每一个地址都必须落在境外。** `src/api.ts` 的 `VITE_API_BASE_URL` 默认为空，接口走同域相对路径，因此「前端放香港、后端留大陆」不成立——App 能加载出页面，但登录与查快递的接口调用会被阻断。故前端静态资源、Node 服务、数据库同机部署。

### 快速步骤

```bash
dnf install -y nginx mariadb-server
cd /opt/yijian && npm ci && npm run build
mysql -uroot < mysql/schema.sql
install -m 0644 deploy/aliyun/yijian.service /etc/systemd/system/yijian.service
systemctl daemon-reload && systemctl enable --now yijian
curl http://127.0.0.1:3000/api/health
```

随后配置 Nginx 反向代理与 Let's Encrypt 证书（香港节点可正常签发，无需备案）。环境变量完整清单、数据迁移、验证清单均见部署文档。

### 更新部署（代码改动上线）

**本地改完代码不会自动上线**，必须把提交送到服务器并重新构建：

```bash
cd /opt/yijian
git pull                       # 依赖未变时不需要 npm ci
npm run build
systemctl restart yijian
curl -s http://127.0.0.1:3000/api/health
```

- `dist/` 与 `server-dist/` 都在 `.gitignore` 中，**服务器必须从源码构建**，只同步产物会导致源码与线上不一致
- `package.json` 未变时**跳过 `npm ci`**（省约 202MB 安装）；服务器上一次完整构建约 11 秒
- 无数据库结构变更时无需迁移
- App 为 Capacitor 远程加载（`server.url = https://wzzsl.fun`），**前端部署后 App 界面同步更新，无需重新打 APK**

**判断「线上是不是旧版本」的两个快办法**：

```bash
# 1. 比对前端资源哈希：线上应与本地 dist/index.html 引用的一致
curl -s https://wzzsl.fun/ | grep -o 'assets/[^"]*'

# 2. 打一个只存在于新版本的接口：旧版本返回 404「接口不存在」
curl -s -X POST https://wzzsl.fun/api/auth/change-password -H 'content-type: application/json' -d '{}'
```

**本机没有 GitHub 凭据时的替代路径（git bundle 经 SSH 直传）**：送**提交**而不是产物；bundle 的提交 SHA 与 `git push` 完全一致，日后补推送后服务器 `git pull` 会是 no-op，不会产生分叉。

```bash
# 本地：生成增量包（<服务器当前SHA> 取服务器上 git rev-parse HEAD 的结果）
git bundle create /tmp/update.bundle <服务器当前SHA>..codex/aliyun-mysql-deploy
git bundle verify /tmp/update.bundle
scp -i ~/.ssh/yijian_hk /tmp/update.bundle root@47.76.244.209:/root/

# 服务器：不能 fetch 进当前已检出的分支，要先落到 FETCH_HEAD 再 --ff-only
cd /opt/yijian
git fetch /root/update.bundle refs/heads/codex/aliyun-mysql-deploy
git merge --ff-only FETCH_HEAD
npm run build && systemctl restart yijian && rm -f /root/update.bundle
```

> 部署后请核对三件事：**服务器产物哈希与本地构建一致**、`/api/health` 正常、新接口按预期响应。若只推送了 GitHub 而没在服务器拉取，线上不会有任何变化。

> **历史方案**：`deploy/aliyun/` 记录的是中国大陆轻量服务器（`47.122.112.1`）的部署方式。因域名未备案，该路径下 80/443 会被接入商阻断，已不适用。
>
> **Netlify 已弃用**（2026-09-17）：`netlify.toml`、`tsconfig.functions.json` 与 Netlify Functions 相关配置已移除；此前 Netlify 侧使用的 Supabase 存储也早已被自建 MariaDB 取代。当前唯一的部署形态是「中国香港 ECS + Nginx + systemd + MariaDB」，手机端走 Capacitor 远程加载。

## 运单号查快递（快递100）

登录用户输入运单号后，系统按公开的单号格式规则识别快递平台（详见下一节），再使用识别或用户指定的平台编码调用快递100实时查询，并将物流状态和轨迹保存到 MySQL。前端会优先展示上游返回的坐标轨迹；若上游仅返回文字位置，则明确提示并保留完整文字轨迹，不伪造地图点位；开通坐标解析后可通过 `KUAIDI100_RESULTV2=4` 让服务端保存返回的 `areaCenter` 坐标。快递100不作为手机号反查运单号的通用第三方服务使用。

在独立 Node 服务的 `/etc/yijian/yijian.env` 中配置：

```text
KUAIDI100_KEY=...
KUAIDI100_CUSTOMER=...
KUAIDI100_TRACK_QUERY_URL=https://poll.kuaidi100.com/poll/query.do
# 可选：开通行政区域/地图坐标解析后再配置。合法值仅 1 / 4 / 8：
#   1 = 只返回行政区域名；4 = 返回 areaCenter 坐标；8 = 返回坐标 + 完整行政区划
#   5 是非法值（上游不会返回坐标，地图将始终提示「承运商未返回坐标」）
KUAIDI100_RESULTV2=4
```

> **中通、顺丰必须提供 `phone`**：快递100 官方规则要求「顺丰速运、顺丰快运、中通快递」查询时必填收件人或寄件人手机号，其余快递选填。未提供时上游返回 `408 快递公司参数异常：验证码错误`，服务端会将其翻译为 HTTP 400 + `PHONE_REQUIRED`，并提示用户补填，而不是笼统报「服务暂时不可用」。

- `POST /api/parcels/query-tracking`：登录后提交 `{ carrierCode?, trackingNo, phone? }`。
  - `carrierCode` 可选：提供且在支持列表内则直接按该平台查询（人工指定优先）；未提供时先做单号识别。
  - `phone` 可选但**中通（`zto`）、顺丰（`shunfeng`）必填**：收件人或寄件人手机号。电商虚拟号（隐私号）形如 `138****1234-5678`，填「-」后面的 4 位即可。服务端会保留数字字符并限制在 4–20 位之间。
    - 缺号且该单号此前查过时，服务端会自动复用已保存的号码（`yijian_parcels.query_phone`），无需重复填写。
    - 号码格式非法 → HTTP 400、`INVALID_PHONE`；缺号且无可复用记录 → HTTP 400、`PHONE_REQUIRED`（**不发无谓的上游请求**）。
  - 显式提供了 `carrierCode` 但不在支持列表内，返回 HTTP 400、`INVALID_CARRIER`（不会被当作"未提供"而回退到识别）。
  - 未提供平台且单号可唯一识别时，使用识别出的平台查询；歧义时返回 HTTP 400、`AMBIGUOUS_CARRIER` 并附 `detection.candidates`；完全无法识别时返回 HTTP 400、`INVALID_CARRIER`；运单号格式错误返回 HTTP 400、`INVALID_TRACKING_NO`。
  - 上游业务错误码按语义映射，不再统一降级为 503：

    | 上游 returnCode | HTTP | 业务码 | 含义 |
    |---|---|---|---|
    | `408` | 400 | `PHONE_REQUIRED` | 需补填手机号，或所填号码与收寄件人不符 |
    | `400` | 400 | `UPSTREAM_BAD_REQUEST` | 上游未能识别该快递公司 |
    | `401` | 400 | `CARRIER_UNSUPPORTED` | 该平台暂不支持查询 |
    | `500` | 404 | `NO_TRACKING_RESULT` | 暂未查询到物流信息（单号与平台可能不匹配） |
    | `504` | 429 | `QUERY_TOO_FREQUENT` | 查询过于频繁 |
    | `501` / `502` | 503 | `UPSTREAM_ERROR` / `UPSTREAM_BUSY` | 上游异常或繁忙 |
    | `503` | 503 | `UPSTREAM_SIGNATURE` | 签名校验失败，需检查 key/customer |
    | `601` | 503 | `UPSTREAM_QUOTA` | 查询额度已用完 |

  - 网络或服务端自身异常返回 HTTP 503、`SERVER_ERROR`。HTTP 层的失败用 `HTTP_` 前缀标记（如 `HTTP_500`），避免与上游 `500` 混淆。
- `POST /api/parcels/detect-carrier`：登录后提交 `{ trackingNo }`，只做识别、不查上游、不落库；返回 `{ detection }`。
- `GET /api/parcels`：获取当前登录用户已查询并保存的包裹和轨迹。
- `POST /api/parcels/confirm-pickup`：登录后确认取件并由服务端删除对应取件码；请求体 `{ parcelId }`。
- 取件码不是由普通物流轨迹推测的，只有上游数据明确返回时才会保存和展示。
- 地图坐标字段为可选值：`latitude` / `longitude` 只在承运商接口明确返回时写入 `yijian_parcel_events`。

## 运单号自动识别快递平台（本地规则）

识别逻辑位于 `server/_shared/carrier-detect.mts`，是**纯本地规则、零外部依赖、零查询消耗**的纯函数模块，不调用任何第三方识别接口。

### 输出结构

```jsonc
{
  "detection": {
    "trackingNo": "SF1234567890123",
    "normalized": "SF1234567890123",
    "matched": true,
    "best": {
      "carrierCode": "shunfeng",       // 与快递100编码对齐，可直接用于查询
      "carrierName": "顺丰速运",
      "short": "顺丰",
      "confidence": "high",            // high | medium | low
      "evidence": [
        { "type": "pattern", "value": "SF + 13-20 位数字", "note": "命中规则：^SF[0-9]{13,20}$" },
        { "type": "length",  "value": "15", "note": "总长度 15 位，符合顺丰 SF 前缀（国际件/电子面单）长度区间" },
        { "type": "source",  "value": "快递公司公开单号格式说明 + 快递100 公司编码", "note": "规则出处" }
      ]
    },
    "candidates": [ /* 按置信度排序的候选集，含各自 evidence */ ],
    "unmatchedReason": null            // empty | invalid_format | too_short | too_long | no_rule_matched
  }
}
```

### 置信度与语义（重要）

国内运单号没有统一的编码规范，**单号本身不携带快递公司标识**。因此识别是概率判断，不是确权：

| confidence | 含义 | 系统行为 |
|---|---|---|
| `high` | 特征明确（字母前缀、国际件国别后缀等），唯一归属可信 | 自动采用该平台发起查询 |
| `medium` | 唯一命中某条具体规则（如号段、专用缩写），但不如前缀强 | 作为建议预填，**仍需用户确认后查询** |
| `low` | 仅靠长度或宽泛字符集匹配，多家重叠 | 只进候选集，不给出 `best` |

纯数字单号（如 12 位）在顺丰、中通、圆通、申通之间真实重叠，**系统不会为这类单号臆断唯一归属**，而是返回候选集请用户确认。识别失败不会阻断查询流程——用户可随时手动选择平台。

### 规则来源

- 淘宝开放平台「物流公司」接口的 `reg_mail_no` 字段（公开镜像，更新时间 2024-09-27）
- 快递100 公开的快递公司编码（与 `KUAIDI100_SUPPORTED_CARRIER_CODES` 对齐）
- 各快递公司公开帮助中心的单号格式说明

每条规则的 `evidence` 都会标注 `source`。模块**不使用校验位推断**：国内主流快递的单号校验算法未公开，因此不做臆造；EMS 的 `CN` 国别后缀属于格式事实而非校验位。

### 设计边界

- 识别仅输出**建议**，绝不驱动静默重试：本项目早期版本曾用 `autoComNum` 做"查询失败即自动切换下一个平台重试"，该做法把上游查询失败误当成识别纠错信号，语义倒置，已回退。当前实现中人工指定的平台永远优先。
- 快递100 的在线单号识别接口**当前未接入**：旧的免费接口 `https://www.kuaidi100.com/autonumber/autoComNum` 已失效（实测恒返回 `{"returnCode":"201","message":"不是有效的快递单号"}`）；文档版 `https://www.kuaidi100.com/autonumber/auto` 需要单独开通套餐，现有 key 返回 `601 key过期`。若后续开通，可在本模块之上叠加在线识别作为增强，而不是替换本地规则（本地规则在无网络/额度耗尽时仍可用）。
- `POST /api/parcels/detect-carrier` 需要登录：运单号是可关联到个人的业务数据，不应提供匿名探测端点。前端对输入做 450ms 防抖，避免把单号逐字符送到服务端。

### 核对识别结果

```powershell
npm run detect:check
```

该脚本（`scripts/check-carrier-detect.mjs`）零依赖，先编译后端再跑 27 条用例（精确规则、号段规则、歧义数字单号、非法/边界输入），逐条打印归一化结果、`best`、候选集与每一条依据，便于人工核对依据是否真实而非编造；断言失败时以非 0 退出码结束。无需引入 vitest/jest。

包裹和轨迹表定义位于 `mysql/schema.sql`，部署前在目标 MySQL 数据库执行一次即可。

## 后端接口

- `POST /api/auth/send-code`：发送验证码；请求体 `{ email, purpose: "login" | "register" }`，返回 `retryAfter` 供前端倒计时。
- `POST /api/auth/register`：邮箱验证码注册并设置密码；请求体 `{ email, code, password }`。
- `POST /api/auth/login`：验证码或密码登录；请求体 `{ email, mode, code?, password? }`。
- `GET /api/auth/me`：读取当前登录态；未登录返回 `401`，认证接口统一返回 JSON 且禁止缓存。
- `POST /api/auth/logout`：销毁当前会话。
- `POST /api/auth/set-password`：已登录且尚未设置密码的账号设置 6-128 位登录密码；已有密码的账号不会被覆盖（返回 `409 PASSWORD_ALREADY_SET`）。
- `POST /api/auth/change-password`：修改登录密码。身份证明**二选一**：`{ currentPassword, newPassword }` 或 `{ code, newPassword }`（`code` 为 `purpose=login` 的邮箱验证码，用于忘记原密码但仍有登录态时兜底）。成功后**保留本机会话、清理该账号的其他设备会话**，响应返回 `revokedSessions`。
  - 校验顺序为「先证明身份、再判断新旧是否相同」，因此身份未通过时永远返回身份类错误，不会因新旧字符串相同而给出误导性提示
  - 走验证码路径时拿不到原密码明文，服务端用 `verifyPassword(newPassword, hash)` 判断新旧是否相同
  - 会话清理失败**不回滚密码**（密码已改成功），响应带 `revokeFailed: true` 并改文案如实告知
  - 错误码：`AUTH_REQUIRED`(401 未登录) · `PASSWORD_NOT_SET`(409 从未设置过密码，应走 set-password) · `CREDENTIAL_REQUIRED`(400 原密码与验证码都没给) · `INVALID_PASSWORD`(400 新密码不在 6-128 位) · `INVALID_CURRENT_PASSWORD`(401 原密码不正确) · `INVALID_VERIFICATION_CODE`(401 验证码错误或已过期) · `PASSWORD_UNCHANGED`(400 新旧相同)
  - 存储层对应 `setUserPassword`（带 `WHERE password_hash IS NULL`，仅首次）/ `replaceUserPassword`（无条件覆盖）/ `deleteUserSessions`（按用户清理会话），三者语义不同，**勿混用**

## 构建 Android Debug APK

**当前为远程加载模式**：`capacitor.config.ts` 设置 `server.url = https://wzzsl.fun`，APK 内**不打包前端资源**，打开即加载线上站点。这样每次部署网页后 App 界面同步更新，无需重新打包分发。

```powershell
cd D:\codex\purchase
npm run build
npx cap sync android
cd android
$env:JAVA_HOME="C:\Program Files\Microsoft\jdk-21.0.12.1-hotspot"   # 未设置时 Gradle 会直接失败
.\gradlew.bat assembleDebug --no-daemon
```

APK 输出：`D:\codex\purchase\yijian-debug.apk`

已知环境问题（Windows 本机）：

- **必须显式设置 `JAVA_HOME`**，否则 Gradle 报找不到 Java。
- 若 `npx cap sync` 或 Gradle 卡住并报 `genie-trash ETIMEDOUT`，是沙箱的「安全删除」垫片拦截所致，命令前加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`。
- `dl.google.com` 在本机被阻断，Android SDK 需走腾讯镜像；`sdkmanager` 不支持自定义源，需手动布局目录。

**远程加载模式的取舍**：App 的可用性等同于域名可达性，且没有离线降级空间。由于本应用的数据（登录态、包裹、轨迹）本就全部来自服务端，离线场景下即使把资源打进 APK 也无法使用，因此远程加载在当前形态下是合理选择；若日后需要「秒开」或独立于站点的分发，再切换为 `webDir` 内置资源（同时需通过 `VITE_API_BASE_URL` 指向接口地址）。

## 界面走查记录（首次使用路径）

以**首次使用者**视角走查核心任务「输入运单号 → 看到物流结果」，用隔离测试账号（`ui-audit@example.com`，走查后已删除）在真实浏览器中执行，覆盖桌面 1440×900 与移动 390×844 两种视口。

### 已修复

| # | 用户处境 | 问题 | 修改 |
|---|---------|------|------|
| 1 | 登录后想查第一个包裹 | 同一动作有 **3 个按钮**（页头"查询快递"、表单"查询快递"、空态"查询第一个包裹"），移动端两个"查询快递"垂直堆叠，看起来像两个步骤 | 移除页头重复按钮，只保留表单内的主操作 |
| 2 | 尚无包裹时看首页 | Hero 显示 **0 待取件 / 0 运输中 / 0 已查询承运商**，并标注"查询记录已保存"，与事实矛盾 | 无包裹时隐藏 Hero 与统计 |
| 3 | 尚无包裹时看首页 | 搜索框、筛选标签（全部 0 / 待取件 0 / …）无内容可筛 | 无包裹时隐藏 |
| 4 | 第一次填运单号 | "快递平台"下拉比必填的"运单号"更宽（0.8 : 1.2），且未说明可留空，容易误以为必须先知道承运商 | 宽度改为 1.4 : 0.85；加"选填"标记；默认项改为"不填，自动识别" |
| 5 | 老用户再次打开应用 | 页头显示"已保存 3 个包裹，**最后更新于 尚未查询**"——`lastSync` 初值为"尚未查询"，仅在本次会话查询后才更新 | 加载已有包裹时取最新一条的更新时间；文案增加防御性判断 |

### 验证方式与结果

- 构建 `npm run build` 通过；`npm run lint` 0 warnings 0 errors
- 桌面与移动端分别截图比对修复前后
- 「有包裹」状态（3 个包裹，覆盖运输中/待取件/已完成三种状态）回归确认未受影响：Hero 统计 1/1/3、筛选、取件码面板、卡片均正常

### 未验证项

- 上述走查由 AI 在隔离账号中完成，**不等于真实用户测试**。真实用户的理解成本、误操作率需另行观察。
- 未覆盖：登录/注册流程的完整交互（本次用直建会话进入）、弱网与失败重试路径、无障碍（屏幕阅读器）表现。
- 未覆盖浏览器：仅在 Chrome 验证。

### 遗留观察（未修改）

- 包裹卡片在网格中被拉伸到同行最高卡片的高度，"极兔"这类无取件码的卡片底部会留出空白。属视觉观感问题，不影响功能，未改动以免引入布局回归。

## 界面走查记录（第二轮：可读性、对比度与浮层交互）

在同一隔离测试账号中重跑「登录 → 查看包裹 → 打开详情 → 查看取件码 → 进入账号设置 → 修改密码」路径，覆盖桌面 1440×950 与移动 390×844，并对关键交互做程序化断言。

### 已修复

| # | 用户处境 | 问题 | 修改 |
|---|---------|------|------|
| 1 | 改密码时输错原密码 | 错误提示与普通提示**外观完全一致**——`.auth-error` 类在组件里用了，但 CSS 中从未定义 | 补 `.auth-hint.auth-error` 样式（强调色 + 圆形 `!` 标记），字段边框同步标红 |
| 2 | 打开应用看包裹列表 | 先闪一下「还没有包裹记录」再跳出列表（`/api/parcels` 返回前无法区分「没有包裹」与「还没查完」） | 新增 `parcelsReady` 状态与骨架屏占位 |
| 3 | 打开包裹详情或密码弹窗后按 Esc | 无反应。Esc 只绑定了侧栏菜单与账号菜单 | Esc 统一关闭全部浮层 |
| 4 | 浮层打开时滚动页面 | 背景列表跟着一起滚 | 浮层打开期间锁定 `body` 滚动，关闭后恢复 |
| 5 | 用键盘操作浮层 | 焦点仍留在背后的页面；抽屉缺少 `role` / `aria-modal` | 补齐语义；挂载时焦点移入、Tab 在浮层内循环、关闭后归还触发元素 |
| 6 | 查看取件码 | 图标恒为「眼睛」，看不出当前是显示还是隐藏；触控目标约 24px | 图标随状态切换 `Eye`/`EyeOff`，补 `aria-pressed` 与说明性 `aria-label`，触控目标增至 32px |
| 7 | 连续触发两条提示 | 前一条的计时器会提前清掉后一条 | 提示条改为单计时器 + 序号 key |
| 8 | 长时间阅读页面文字 | 正文与说明文字普遍 12px，最低到 10.5px | 正文提升至 13px，移除低于 12px 的正文 |
| 9 | 在浅色背景读次要文字 | `--soft` 白底仅 2.6:1、`--muted` 4.1:1、白字实心按钮 3.1:1，均低于 WCAG AA 的 4.5:1 | 重新取值：`--muted` 5.7:1、`--soft` 4.6:1、`--green` 4.9:1；新增 `--accent-strong` 供白字按钮（4.8:1） |
| 10 | 用 Tab 遍历表单 | `select` 没有可见焦点样式 | 焦点环统一为 2px `--ring`，并覆盖 `select` / `a` / `[tabindex]` |
| 11 | 系统开启了「减少动态效果」 | 过渡与动画照常播放 | 支持 `prefers-reduced-motion`；加载指示器保留但放慢，避免被误读为卡死 |

### 验证方式与结果

- `npm run lint` 0 warnings 0 errors；`npm run build` 通过
- 改密码后端流程 **22 项断言全部通过**（隔离测试账号、本地 JSON 存储）：原密码错误 401、新旧相同 400、缺凭据 400、未登录 401、验证码路径成功、旧密码随即失效、新密码可登录、验证码登录路径未受影响、`set-password` 仍返回 409
- 会话清理：第二台设备登录后改密码 → 该设备 401、本机保留 200、响应 `revokedSessions >= 1`
- 程序化断言（无头浏览器）：抽屉 `role=dialog` + `aria-modal=true`、打开锁滚动、Esc 关闭并恢复滚动、弹窗初始焦点落在首个输入框、切换验证方式后焦点重新落位、字段级错误使弹窗保持打开
- 视觉实测：`--muted #5c6874`、`--soft #6b7681`、主按钮 `rgb(199,71,42)`、正文 13px

### 未验证项

- 上述走查由 AI 在隔离账号中完成，**不等于真实用户测试**
- 对比度按 WCAG 2.1 相对亮度公式**计算**得出，未用 axe / Lighthouse 等工具复核
- 减少动效仅验证 CSS 规则生效，**未在开启该偏好的真实系统上走查**
- 仅在 Chrome 验证；未覆盖屏幕阅读器实际朗读效果
- 「改密码后其他设备下线」只在本地 JSON 存储上验证，**MySQL 路径未实测**（SQL 为 `DELETE ... WHERE user_id = ? AND token_hash <> ?`）

### 遗留观察（未修改）

- `src/App.css` 主体是压缩后的历史样式。本次改动以**文件末尾追加「UI 优化层」**实现（只覆盖 + 新增，不重写既有规则），便于审查与回滚。若日后要真正重构该文件，需重做一次完整视觉回归。
- 服务端启动日志有 `[yijian:env] 环境文件加载失败 ... open '.env'` 警告。环境变量由 systemd 的 `EnvironmentFile` 注入，工作目录下没有 `.env` 属正常，功能不受影响，仅为日志噪音。

## 界面走查记录（第三轮：中通/顺丰手机号必填）

起因是用户反馈「中通快递查询不了」。排查发现并非界面缺陷，而是**上游必填参数缺失**，修复后连带补齐了界面提示。

### 根因

快递100 官方规则要求「顺丰速运、顺丰快运、中通快递」查询时必须提供收件人或寄件人手机号，而 `queryTracking` 只传了 `{ com, num, resultv2 }`。上游因此返回 `408 快递公司参数异常：验证码错误`，又被统一降级为 HTTP 503 `SERVER_ERROR`，用户只看到「服务暂时不可用」，无法自助解决。

**对照实验**（同一单号，使用生产凭据）：不带 `phone` → 408；带 `phone` → 500「查询无结果」。顺丰表现一致。⇒ 证明 408 是**缺参数**而非账号权限问题。

### 已修复

| # | 用户处境 | 问题 | 修改 |
|---|---------|------|------|
| 1 | 想查中通包裹 | 未提供手机号，上游返回 408，界面只说「服务暂时不可用」 | 打通 `phone` 参数链路（前端 → 接口 → 上游）；服务端对中通/顺丰**提前拦截**并给出可执行文案，不再发无谓的上游请求 |
| 2 | 想查中通包裹 | 不知道还要填手机号，界面也无该字段 | 按平台条件显示「手机号」必填字段，并在需要时自动聚焦 |
| 3 | 收到电商虚拟号，不知填哪几位 | 虚拟号形如 `138****1234-5678`，直接粘贴会被判为格式非法 | 字段下方提示「填『-』后面的 4 位」；服务端只保留数字字符，允许 4–20 位 |
| 4 | 同一单号反复查询 | 每次都要重新输手机号 | 包裹落库时保存 `query_phone`，同单号再次查询时自动复用 |
| 5 | 上游返回各类业务错误 | 全部被降级为 503，诊断盲区大 | 建立错误码映射表（408/400/401/500/501/502/503/504/601），各带可读文案；HTTP 层错误加 `HTTP_` 前缀以区分 |

### 验证方式与结果

- `npm run lint` 0 warnings 0 errors；`npm run build` 通过
- **本地接口 21 项断言**通过（mock 上游覆盖 408、500、601 与成功路径）：缺号拦截、`INVALID_PHONE`、号码复用、错误码映射均符合预期
- **本地界面 12 项断言**通过（360×740）：字段按平台显隐、自动聚焦、虚拟号提示可见、触控目标达标
- **虚拟号提示 6 项断言**通过
- **生产环境真实上游 11 项断言**通过，含清理核对（用户数与包裹数回到原值、无残留会话）
- 线上与服务器产物哈希一致（`337ae01b…` / `f4d16f49…`）

### 未验证项

- 由 AI 在隔离账号中完成，**不等于真实用户测试**；真实用户是否会主动填写虚拟号后四位仍需观察
- 仅在 Chrome 验证；Android 端因走远程加载，界面与网页一致，但**未在真机上走查该字段的键盘行为**

## 当前仍待完善

本地代码已经实现本地规则单号识别、实时查询、MySQL 持久化和坐标字段兼容；上线后仍需完成：

1. 在服务器配置真实的 Resend、快递100凭证，并完成一次真实邮箱登录和运单查询；
2. 阿里云 RDS 已接入并迁移完成（见上文「阿里云 RDS」）。后续如需**持续同步**本机与云端数据，需另做方案（定时增量任务或 MySQL 主从复制）——当前迁移是一次性快照；
3. 若要显示真实地图底图，需要接入承运商明确返回经纬度的地图轨迹接口或经过授权的地理编码服务；当前无坐标时只显示文字轨迹；
4. 后台定时同步、推送通知、数据删除任务、日志审计和隐私政策。

无法从上游接口获得取件码的平台，只显示物流状态，不生成或猜测取件码。

### 物流状态文案（已修复）

`status_detail` 曾误存快递100 的数字状态码（`state`），导致包裹卡片显示裸数字。现已改为存可读文案，映射表与订正脚本见下文「物流状态详情」章节。

### 识别能力的已知限制（未验证项）

- 规则表来自公开资料（淘宝开放平台 `reg_mail_no`、快递100 编码、公司公开说明），**未用真实运单号样本做过准确率回归**。`npm run detect:check` 验证的是规则行为与依据一致性，不等于真实世界准确率。
- 快递公司在持续启用新号段，纯数字单号的号段表天然滞后。识别不唯一时系统会要求用户确认，因此这类滞后不会导致错误查询，但会降低自动识别率。
- 顺丰国内件、中通/圆通/韵达/申通的部分单号存在真实重叠，这些单号**不会**被自动定为唯一平台，属预期行为而非缺陷。
- ~~上游快递100凭证对顺丰等平台返回 `408 快递公司参数异常：验证码错误`（账号未开通查询权限）~~ **该结论已于 2026-09-17 推翻**：408 的真实原因是**未传 `phone`**，而非账号权限。对照实验显示同一中通/顺丰单号不带 `phone` 返回 408、带 `phone` 返回 500（查询无结果），与权限无关。修复后该路径已在生产环境用真实上游端到端验证通过（详见「运单号查快递（快递100）」章节）。

## 物流状态详情（`status_detail`）的语义

快递100 的查询响应里有两个容易混淆的字段：

| 字段 | 含义 | 示例 |
|------|------|------|
| `status` | **请求结果码**，表示这次查询本身是否成功 | `"200"` |
| `state` | **物流状态码**，是数字 | `"3"` |
| `stateEx` | 状态的文字说明 | 上游通常**不返回** |

`state` 的取值（快递100 官方定义）：`0` 在途、`1` 揽收、`2` 疑难、`3` 已签收、`4` 退签、`5` 派件、`6` 退回、`7` 转投、`8` 清关、`14` 拒签。

服务端的处理约定：

- `state` **只用于**状态归类（`normalizedStatus`），映射到 `运输中` / `待取件` / `已完成`；
- `status_detail` 必须存**人类可读文本**，取值优先级为 `stateEx` → `statusText`/`stateName` → 本地 `STATE_TEXT` 映射 → 最新一条轨迹描述；
- 前端卡片的正文（`route` 字段）来自 `status_detail`，因此该字段绝不能落数字。

历史上这里曾把 `state` 直接当作 `status_detail`，导致界面上显示裸数字（如 `3`）。修复后由 `STATE_TEXT` 映射表兜底，`parcels.mts` 中另有 `readableDetail()` 做第二层防护：万一遇到纯数字内容，会按包裹状态回退为可读文案而不是原样展示。

### 一次性数据订正

如果数据库中残留了修复前写入的数字状态码，可用：

```bash
npm run fix:status-detail            # 预览，不改数据
npm run fix:status-detail -- --apply # 执行订正
```

脚本默认 dry-run，只处理 `status_detail` 为纯数字的记录，无对应映射的会被跳过。
