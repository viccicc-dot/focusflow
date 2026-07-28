# FocusFlow 预览与云端部署

## 一键本地预览（Windows）

1. 在 GitHub 仓库页面点击 **Code → Download ZIP**。
2. 完整解压 ZIP，不要直接在压缩包内部运行文件。
3. 双击根目录中的 `启动FocusFlow.bat`。
4. 脚本会自动完成：
   - 检查 Node.js 版本（要求 22 或更高）
   - 从 `.env.example` 创建 `.env`
   - 安装或同步 npm 依赖
   - 启动前端和后端
   - 打开 `http://localhost:5173`
5. 停止服务时，回到命令窗口按 `Ctrl+C`。

本地演示账号：

```text
邮箱：demo@focusflow.local
密码：demo1234
```

如果 npm 下载失败，通常是当前网络无法稳定访问 npm 软件源。切换网络后重新双击启动文件即可。

---

## Render 部署（推荐用于稳定预览）

仓库根目录包含 `render.yaml`。该 Blueprint 使用 Docker 构建、Singapore 区域、HTTP 健康检查和持久磁盘。

### 创建步骤

1. 注册或登录 Render。
2. 选择创建 Blueprint，并授权访问 `viccicc-dot/focusflow`。
3. 选择仓库后，Render 会读取根目录的 `render.yaml`。
4. 检查即将创建的 `focusflow` Web Service。
5. 确认付费方案和 1GB 持久磁盘，然后执行部署。
6. 部署成功后，Render 会提供 `*.onrender.com` 地址。

### 已自动配置

- 使用根目录 `Dockerfile`
- `/api/health` 健康检查
- GitHub 检查通过后自动部署
- 自动生成 `JWT_SECRET`
- SQLite 数据库路径：`/app/persistent/focusflow.db`
- 附件路径：`/app/persistent/uploads`
- 生产环境不创建公开演示账号

Render 的持久磁盘只能用于单实例服务。当前 SQLite 架构也只适合单实例运行。

---

## Railway 部署（适合快速连接 GitHub）

仓库根目录包含 `railway.json`。Railway 会使用根目录 `Dockerfile`，并对 `/api/health` 执行部署健康检查。

### 创建步骤

1. 注册或登录 Railway。
2. 创建 Project，选择 **Deploy from GitHub repo**。
3. 授权并选择 `viccicc-dot/focusflow`。
4. 在服务的 Variables 中添加以下变量：

```dotenv
NODE_ENV=production
JWT_SECRET=请填写随机长密钥
DATABASE_PATH=/data/focusflow.db
UPLOAD_DIR=/data/uploads
SEED_DEMO=false
```

可以在本机执行以下命令生成随机密钥：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

5. 为该服务创建一个 Volume，并将挂载路径设置为：

```text
/data
```

6. 在 Networking 中生成公开域名。
7. 等待部署和健康检查通过。

**不要省略 Volume。** 没有 Volume 时，SQLite 数据库和附件会在重新部署或重启后丢失。

---

## 自动部署流程

合并到 `main` 后：

1. GitHub Actions 安装依赖、检查服务端语法并构建前端。
2. Render 在检查通过后自动部署。
3. Railway 在启用 GitHub 自动部署后构建新 Docker 镜像并发布。
4. `/api/health` 返回成功后，平台才会把流量切换到新版本。

---

## 正式生产环境的下一步

当前云端配置适合个人或小团队单实例预览。正式产品上线前，应继续完成：

- 将 SQLite 迁移到 PostgreSQL
- 将附件迁移到对象存储
- 配置邮件验证与密码找回
- 配置错误监控、备份和审计日志
- 使用独立域名和 HTTPS
- 删除或更换所有演示凭据
