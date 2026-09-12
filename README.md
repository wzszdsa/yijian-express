# 驿见 · 快递聚合查询 MVP

一个面向网页和 Android 的快递聚合查询应用：邮箱登录、邮箱验证码、密码登录、手动输入运单号查件、地图轨迹展示、包裹状态、到站取件码和服务端保存的“我已取件”流程均已做成可交互流程。当前产品定位是“输入运单号后查询并保存”，不要求用户单独绑定快递账号。

## 当前完成

- 响应式 Web 工作台：桌面端侧边栏，移动端折叠菜单。
- 邮箱登录和注册：邮箱验证码用于验证身份，注册时必须设置 6-128 位登录密码；早期仅验证码账号可在“账号设置”中补充密码。
- 后端认证：注册、密码哈希、验证码校验、会话 Cookie、登录态恢复、退出登录；认证状态在启动时恢复，错误和加载状态有明确反馈。
- 邮件适配器：开发环境 `console` 演示模式；生产环境使用 Resend 邮件服务。
- 验证码安全控制：5 分钟过期、60 秒重发间隔、单小时发送上限、错误次数上限。
- 持久化：阿里云独立后端使用 MySQL/MariaDB；本地可使用 JSON 文件演示，不会提交到版本库。
- 承运商识别：顺丰、京东、中通、圆通、韵达、申通、极兔、德邦、EMS 等；服务端通过快递100自动识别运单号对应的平台。
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

独立 Node 服务会同时托管 `dist/` 前端和 `/api/*` 接口：

```powershell
cd D:\codex\purchase
$env:STORAGE_PROVIDER = "local"
$env:EMAIL_PROVIDER = "console"
$env:AUTH_EXPOSE_DEMO_CODE = "true"
npm run build
npm run dev:server
```

打开 `http://127.0.0.1:3000/`。开发环境可用控制台演示验证码，不会向真实邮箱发送邮件。

## 真实邮件服务：Resend

1. 创建 Resend Token。
2. 准备一个已验证的发件人地址或域名。
3. 在独立 Node 服务的 `/etc/yijian/yijian.env` 中配置：

```text
EMAIL_PROVIDER=resend
RESEND_TOKEN=...
EMAIL_FROM=驿见 <no-reply@你的已验证域名>
EMAIL_SUBJECT=驿见邮箱验证码
AUTH_EXPOSE_DEMO_CODE=false
```

真实 API Key 只配置在服务器环境变量中，前端不会读取。

## MySQL 数据库配置（阿里云生产）

独立后端通过 `mysql2` 连接 MySQL 或 MariaDB，生产环境建议让数据库只监听内网或本机，不开放公网 3306。建表脚本位于 `mysql/schema.sql`，包含账号、验证码、会话、包裹和物流轨迹表。

```text
NODE_ENV=production
APP_HOST=0.0.0.0
PORT=80
PUBLIC_ORIGIN=http://47.122.112.1
WEB_ROOT=/opt/yijian/dist
STORAGE_PROVIDER=mysql
MYSQL_URL=mysql://yijian_app:数据库密码@127.0.0.1:3306/yijian
MYSQL_CONNECTION_LIMIT=8
```

`MYSQL_URL`、邮件 Token 和快递100凭证只放在服务器的 `/etc/yijian/yijian.env`，不要写入前端、不要提交 Git。若使用阿里云 RDS，需先在 RDS 白名单中允许服务器私网 IP，并把 `MYSQL_URL` 改成 RDS 地址；服务器当前检测到已有 RDS 私网地址但 TCP 3306 未连通，因此本次部署优先使用服务器本机 MariaDB。

## 部署到阿里云轻量应用服务器

当前目标服务器为 `47.122.112.1`（Alibaba Cloud Linux 3）。部署文件和 systemd 模板位于 `deploy/aliyun/`：

```bash
cd /opt/yijian
npm ci
npm run build
mysql -uroot < mysql/schema.sql
install -m 0644 deploy/aliyun/yijian.service /etc/systemd/system/yijian.service
systemctl daemon-reload
systemctl enable --now yijian
curl http://127.0.0.1/api/health
```

服务启动后可通过 `http://47.122.112.1/` 访问；如果要使用 `wzzsl.cloud`，还需要把域名 A 记录指向 `47.122.112.1`，并另行配置 HTTPS 证书。当前代码部署不依赖 Netlify Functions。

## 运单号查快递（快递100）

登录用户手动输入运单号后，服务端先调用快递100单号识别接口识别承运商，再调用实时查询接口，并将物流状态和轨迹保存到 MySQL。前端会优先展示上游返回的坐标轨迹；若上游仅返回文字位置，则明确提示并保留完整文字轨迹，不伪造地图点位；开通坐标解析后可通过 `KUAIDI100_RESULTV2=5` 让服务端保存返回的 `areaCenter` 坐标。快递100不作为手机号反查运单号的通用第三方服务使用。

在独立 Node 服务的 `/etc/yijian/yijian.env` 中配置：

```text
KUAIDI100_KEY=...
KUAIDI100_CUSTOMER=...
KUAIDI100_TRACK_QUERY_URL=https://poll.kuaidi100.com/poll/query.do
KUAIDI100_RECOGNIZE_URL=https://www.kuaidi100.com/autonumber/autoComNum
# 可选：开通行政区域/地图坐标解析后再配置
KUAIDI100_RESULTV2=5
```

- `POST /api/parcels/query-tracking`：登录后提交一个运单号，查询并保存物流轨迹。
- `GET /api/parcels`：获取当前登录用户已查询并保存的包裹和轨迹。
- `POST /api/parcels/confirm-pickup`：登录后确认取件并由服务端删除对应取件码；请求体 `{ parcelId }`。
- 取件码不是由普通物流轨迹推测的，只有上游数据明确返回时才会保存和展示。
- 地图坐标字段为可选值：`latitude` / `longitude` 只在承运商接口明确返回时写入 `yijian_parcel_events`。

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

## 当前仍待完善

本地代码已经接入快递100单号识别、实时查询、MySQL 持久化和坐标字段兼容；上线后仍需完成：

1. 在服务器配置真实的 Resend、快递100凭证，并完成一次真实邮箱登录和运单查询；
2. 如果改用阿里云 RDS，先放通服务器到 RDS 的私网访问，再把 `MYSQL_URL` 切换到 RDS；
3. 若要显示真实地图底图，需要接入承运商明确返回经纬度的地图轨迹接口或经过授权的地理编码服务；当前无坐标时只显示文字轨迹；
4. 后台定时同步、推送通知、数据删除任务、日志审计和隐私政策。

无法从上游接口获得取件码的平台，只显示物流状态，不生成或猜测取件码。
