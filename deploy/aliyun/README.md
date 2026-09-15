# 阿里云轻量服务器部署（中国大陆 · 历史方案）

> **已不适用**：ICP 备案约束服务器接入环节，域名未备案时中国大陆节点的 80/443 会被接入商阻断。当前部署方案见 [`../hongkong/README.md`](../hongkong/README.md)（中国香港 ECS，免备案）。本文件保留作为历史记录，其中 `yijian.service` 模板与地域无关，香港方案仍在复用。

本项目的独立 Node 服务同时提供 `dist/` 静态前端和 `/api/*` 后端接口，生产持久化使用 MySQL/MariaDB。

## 服务器目录

- 应用：`/opt/yijian`
- 环境变量：`/etc/yijian/yijian.env`
- systemd：`/etc/systemd/system/yijian.service`
- HTTP：默认监听 `0.0.0.0:80`

## 首次部署核心步骤

```bash
cd /opt/yijian
npm ci
npm run build
mysql -uroot < mysql/schema.sql
install -m 0644 deploy/aliyun/yijian.service /etc/systemd/system/yijian.service
systemctl daemon-reload
systemctl enable --now yijian
```

不要把 `.env`、数据库密码、邮件 Token 或快递100凭证提交到 Git。生产环境变量写入 `/etc/yijian/yijian.env`，权限设为 `0600`。
