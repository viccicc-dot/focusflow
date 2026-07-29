# Windows 启动脚本安全说明

## 2026-07-29 变更

旧的 `启动FocusFlow.bat` 已删除。旧脚本同时执行了 `npm install`，并使用隐藏 PowerShell 延迟打开浏览器。虽然仓库检查未发现下载并执行陌生程序、编码载荷或可疑域名，但这种组合行为容易触发安全软件的“下载器”启发式检测，也不够透明。

请不要恢复旧脚本，不要为旧脚本添加杀毒软件白名单。

## 新脚本

新版文件名为：

```text
Start-FocusFlow.cmd
```

新版行为：

1. 切换到脚本所在目录。
2. 检查 `package.json`、Node.js 版本和 `.env.example`。
3. 必要时复制 `.env.example` 为 `.env`。
4. 仅在 `node_modules` 不存在时，明确提示即将从 npm 注册表下载锁定依赖，并要求用户输入 `Y` 确认。
5. 使用 `npm ci --no-audit --no-fund`，按照 `package-lock.json` 安装依赖。
6. 在新的可见 `cmd.exe` 窗口运行 `npm.cmd run dev`。
7. 使用 Windows 自带的 `start` 打开 `http://localhost:5173`。

新版明确不包含：

- PowerShell 调用
- 隐藏窗口
- `curl`、`wget` 或 `Invoke-WebRequest`
- Base64 解码或动态执行
- 下载并启动独立 EXE/DLL
- 修改 Defender、防火墙、注册表或执行策略
- 管理员权限请求

## 手动运行替代方案

不信任任何脚本时，可以完全不运行 CMD 文件，直接在项目目录执行：

```powershell
Copy-Item .env.example .env
npm.cmd ci --no-audit --no-fund
npm.cmd run dev
```

然后打开：

```text
http://localhost:5173
```

## 依赖范围

项目直接依赖列在 `package.json`，锁定的传递依赖列在 `package-lock.json`。主要组件包括 React、Vite、Express、SQLite、日期处理、Cookie、JWT、限流和文件上传库。

GitHub Actions 会验证：

- 旧 BAT 不存在
- 新 CMD 存在
- 新 CMD 不包含 `powershell.exe` 或 `WindowStyle Hidden`
- 前端能完成生产构建
- 服务端 JavaScript 通过语法检查
- Docker 镜像可以构建
