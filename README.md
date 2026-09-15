# 驿见 · 快递聚合查询 MVP

一个面向网页和 Android 的快递聚合查询应用：邮箱登录、邮箱验证码、密码登录、选择快递平台并输入运单号查件、地图轨迹展示、包裹状态、到站取件码和服务端保存的“我已取件”流程均已做成可交互流程。当前产品定位是“输入运单号后查询并保存”，不要求用户单独绑定快递账号。

## 当前完成

- 响应式 Web 工作台：桌面端侧边栏，移动端折叠菜单。
- 邮箱登录和注册：邮箱验证码用于验证身份，注册时必须设置 6-128 位登录密码；早期仅验证码账号可在“账号设置”中补充密码。
- 后端认证：注册、密码哈希、验证码校验、会话 Cookie、登录态恢复、退出登录；认证状态在启动时恢复，错误和加载状态有明确反馈。
- 邮件适配器：开发环境 `console` 演示模式；生产环境使用 Resend 邮件服务。
- 验证码安全控制：5 分钟过期、60 秒重发间隔、单小时发送上限、错误次数上限。
- 持久化：阿里云独立后端使用 MySQL/MariaDB；本地可使用 JSON 文件演示，不会提交到版本库。
- 平台查询：输入运单号后按公开单号规则自动识别快递平台（也可手动指定），服务端使用识别或指定的平台调用快递100实时查询；覆盖顺丰、京东、中通、圆通、韵达、申通、极兔、德邦、EMS、邮政等。
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

> **历史方案**：`deploy/aliyun/` 记录的是中国大陆轻量服务器（`47.122.112.1`）的部署方式。因域名未备案，该路径下 80/443 会被接入商阻断，已不适用。当前代码部署不依赖 Netlify Functions。

## 运单号查快递（快递100）

登录用户输入运单号后，系统按公开的单号格式规则识别快递平台（详见下一节），再使用识别或用户指定的平台编码调用快递100实时查询，并将物流状态和轨迹保存到 MySQL。前端会优先展示上游返回的坐标轨迹；若上游仅返回文字位置，则明确提示并保留完整文字轨迹，不伪造地图点位；开通坐标解析后可通过 `KUAIDI100_RESULTV2=5` 让服务端保存返回的 `areaCenter` 坐标。快递100不作为手机号反查运单号的通用第三方服务使用。

在独立 Node 服务的 `/etc/yijian/yijian.env` 中配置：

```text
KUAIDI100_KEY=...
KUAIDI100_CUSTOMER=...
KUAIDI100_TRACK_QUERY_URL=https://poll.kuaidi100.com/poll/query.do
# 可选：开通行政区域/地图坐标解析后再配置
KUAIDI100_RESULTV2=5
```

- `POST /api/parcels/query-tracking`：登录后提交 `{ carrierCode?, trackingNo }`。
  - `carrierCode` 可选：提供且在支持列表内则直接按该平台查询（人工指定优先）；未提供时先做单号识别。
  - 显式提供了 `carrierCode` 但不在支持列表内，返回 HTTP 400、`INVALID_CARRIER`（不会被当作"未提供"而回退到识别）。
  - 未提供平台且单号可唯一识别时，使用识别出的平台查询；歧义时返回 HTTP 400、`AMBIGUOUS_CARRIER` 并附 `detection.candidates`；完全无法识别时返回 HTTP 400、`INVALID_CARRIER`；运单号格式错误返回 HTTP 400、`INVALID_TRACKING_NO`。只有上游、网络或服务端异常才返回 HTTP 503、`SERVER_ERROR`。
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
- `POST /api/auth/set-password`：已登录且尚未设置密码的账号设置 6-128 位登录密码；已有密码的账号不会被覆盖。

## 构建 Android Debug APK

```powershell
cd D:\codex\purchase
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug --no-daemon
```

APK 输出：

`D:\codex\purchase\yijian-debug.apk`

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
- 上游快递100凭证当前对顺丰等平台返回 `408 快递公司参数异常：验证码错误`（该账号未开通对应查询权限），因此本文档描述的端到端查询路径只验证到"正确构造请求、正确区分 400/503"，**未验证到成功取回真实轨迹**。此状态在本次改动前即存在（已用改动前的代码对照确认）。

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
