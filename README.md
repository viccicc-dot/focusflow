# FocusFlow — Todoist 风格全栈任务管理应用

这是一个可独立部署的全栈任务管理项目。它复刻 Todoist 的主要信息架构与核心工作流，但使用自有名称、图形和代码，不包含 Todoist 的商标、Logo、专有素材或私有 API。

## 当前已实现

- 邮箱注册、登录、退出和 HttpOnly Cookie 会话
- 工作区、成员角色和邀请记录
- 收件箱、今天、预览、已完成
- 项目、子项目、分区
- 列表、看板、14 天日历视图
- 任务创建、编辑、删除、完成与恢复
- 子任务、描述、负责人、四级优先级
- 日期、时间、截止日期、任务时长
- 每天、工作日、每周、每月、每年及间隔重复任务
- 标签和自定义筛选器
- 评论、10MB 内附件上传
- 站内提醒与通知中心
- 快速添加语法和全局搜索
- 深色模式、响应式移动端侧栏
- SQLite 持久化、Docker 部署配置
- 基础安全：密码哈希、限流、Helmet、安全 Cookie、工作区访问校验

## 快速添加示例

```text
准备周会 明天 #工作 @专注 p1
每天阅读 20 分钟 今天 #阅读清单 p3
提交月报 2026-08-01 每月 p2
```

支持：`今天`、`明天`、`后天`、`YYYY-MM-DD`、`每天`、`每周`、`每月`、`每年`、`工作日`、`#项目`、`@标签`、`p1` 到 `p4`。

## Windows 一键启动

要求 Node.js 22 或更高版本。完整解压 ZIP 后，可以双击：

```text
Start-FocusFlow.cmd
```

首次运行时，脚本会明确询问是否从 npm 注册表安装 `package-lock.json` 锁定的依赖；所有命令均显示在可见窗口中。脚本不会调用 PowerShell、不会隐藏窗口，也不会请求管理员权限。详细说明见 `WINDOWS_LAUNCHER_SECURITY.md`。

旧的 `启动FocusFlow.bat` 已因不够透明的隐藏 PowerShell 写法被删除。请不要恢复旧文件，也不要为旧文件添加安全软件白名单。

## 本地运行

要求 Node.js 22 或更高版本。

```bash
cp .env.example .env
npm install
npm run dev
```

开发环境：

- 前端：http://localhost:5173
- 后端：http://localhost:4173

生产模式：

```bash
npm run build
npm start
```

访问：http://localhost:4173

演示账号：

```text
demo@focusflow.local
密码：demo1234
```

## Docker 运行

```bash
docker compose up --build
```

访问：http://localhost:4173

首次正式部署前，请把 `docker-compose.yml` 中的 `JWT_SECRET` 改成至少 32 位随机字符串。

## 环境变量

```dotenv
PORT=4173
JWT_SECRET=replace-with-a-long-random-secret
APP_ORIGIN=http://localhost:4173
DATABASE_PATH=./data/focusflow.db
UPLOAD_DIR=./uploads
```

## 项目结构

```text
focusflow/
├── client/
│   ├── src/App.jsx          # 主界面与交互
│   ├── src/api.js           # API 请求封装
│   └── src/styles.css       # 响应式主题样式
├── server/
│   ├── index.js             # REST API、登录、上传与静态服务
│   ├── db.js                # SQLite 数据模型
│   ├── recurrence.js        # 重复日期计算
│   └── seed-data.js         # 账号及演示数据初始化
├── data/                    # SQLite 数据库目录
├── uploads/                 # 附件目录
├── Dockerfile
└── docker-compose.yml
```

## 快捷键

- `Q`：快速添加任务
- `/`：搜索
- `Ctrl/Cmd + K`：搜索
- `Esc`：关闭弹窗或任务详情

## 仍需外部账号才能完成的线上能力

以下功能的代码接入需要由站点所有者创建第三方账号和密钥；不要把生产密钥直接提交到代码仓库：

- Google / Apple OAuth 登录
- 邮件邀请、邮件提醒和找回密码
- 浏览器、iOS、Android 推送通知
- Google Calendar / Outlook Calendar 双向同步
- Stripe 等订阅付费
- S3 / Supabase Storage 等对象存储
- 正式域名、HTTPS 和云平台账号

当前附件保存在服务器本地磁盘；单实例部署可以直接使用。多实例或无状态云部署时，应改为对象存储。SQLite 适合本地、个人和小团队单实例部署；大规模多人协作应迁移到 PostgreSQL，并增加 WebSocket 实时同步、队列、审计日志和备份策略。

## API 概览

- `/api/auth/*`：注册、登录、退出、当前用户
- `/api/bootstrap`：加载工作区完整数据
- `/api/projects`、`/api/sections`：项目与分区
- `/api/tasks`：任务 CRUD、完成、恢复
- `/api/labels`、`/api/filters`：标签与筛选器
- `/api/tasks/:id/comments`：评论
- `/api/tasks/:id/attachments`：附件
- `/api/tasks/:id/reminders`：提醒
- `/api/team/*`：成员与邀请
- `/api/notifications`：通知中心
- `/api/search`：服务端搜索

## 生产上线建议

1. 将 SQLite 迁移到 PostgreSQL。
2. 使用 Redis 保存会话、限流和实时事件。
3. 使用对象存储保存附件。
4. 接入邮件与推送服务。
5. 配置自动备份、错误监控和审计日志。
6. 使用独立品牌名称和视觉资产，避免商标混淆。
