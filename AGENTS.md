# AGENTS.md

## 项目概览

这是“英语教师教学工作台 V3”，由原生静态前端、Cloudflare Worker/D1/R2 后端和 Electron/Capacitor 应用壳组成。

- 前端：`teacher-workbench/frontend/`，原生 HTML/CSS/JS SPA，无前端构建步骤。
- 后端：`teacher-workbench/worker/`，Cloudflare Workers + Hono + D1 + R2。
- 桌面端：`desktop/main.cjs`、`desktop/preload.cjs`，Electron。
- Android：`android/`，Capacitor 7 + Gradle。
- 数据库迁移：`teacher-workbench/worker/migrations/`。
- 发布工作流：`.github/workflows/desktop-release.yml`。
- 产品和部署文档：根目录设计文档、`teacher-workbench/README.md` 及 `teacher-workbench/docs/`。

生产地址：

- Pages 前端：`https://fff.xmoj-script.uk`
- Worker API：`https://fff-api.xmoj-script.uk/api/v1`
- R2 公共文件域名：`https://fff-file-r2-cloudflare.xmoj-script.uk`

## 基本协作规则

- 先读取相关文件和邻近调用点，再做最小范围修改。
- 不撤销用户已有改动，不使用 `git reset --hard` 或 `git checkout --` 覆盖文件。
- 不提交密钥、keystore、密码、`.dev.vars` 或真实 API token。
- 不为了无关问题重构代码；保持现有原生 JS、Hono、Capacitor 和 Electron 结构。
- 修改后优先运行针对性检查，再扩大验证范围。
- 新增前端可见文案必须同时覆盖 `zh-CN`、`zh-TW`、`en`，并通过 `I18n.t()` 或 `I18n.format()` 使用。
- 前端用户输入、后端返回内容进入 HTML 时，遵循现有 `App.esc()` 等转义模式。
- 涉及 D1 schema 的修改必须新增迁移文件，不直接改已发布迁移。

## 常用命令

根目录：

```bash
npm install
npm run desktop:dev
npm run desktop:dist:win
npm run desktop:dist:mac
npm run mobile:sync
npm run mobile:apk
```

Worker：

```bash
cd teacher-workbench/worker
npm install
npx wrangler dev --local --port 8787
npx wrangler d1 migrations apply DB --local
```

前端可使用任意静态服务器运行；项目没有 Vite/Webpack 构建步骤。修改静态 JS 后至少运行：

```bash
node --check teacher-workbench/frontend/<changed-file>.js
git diff --check
```

## 更新体系

项目有两套不同的版本清单，不能混用：

### 前端资源清单

`teacher-workbench/frontend/update-manifest.json` 控制 HTML、JS、CSS、JSON 和其他静态资源的在线更新。
当前清单的 `version` 必须在发布前递增；`files` 必须包含完整前端程序文件，尤其是：

- `index.html`
- `styles.css`
- `i18n.js`
- `app.js`
- `api.js`
- `auth.js`
- `landing.js`
- `update.js`
- 相关 `views/*.js`
- 前端运行时需要的 `assets/*`

浏览器和 APK 通过 `frontend/sw.js` 更新缓存；Electron 由 `desktop/main.cjs` 在创建窗口前下载远程文件到用户数据目录。网络失败时必须继续使用本地资源。前端资源更新不会更新 Electron 主进程、Android 原生代码、权限、数据库或安装包。

### 安装包清单

R2 上的 `app-update.json` 控制安装包版本，包含：

- `platforms.windows`
- `platforms.macos`
- `platforms.android`

`frontend/update.js` 会根据运行平台检查安装包新版本。当前行为是弹窗后打开下载地址，不是静默安装：

- Windows 用户需要手动运行 `.exe`。
- macOS 用户需要手动打开 `.dmg` 并处理 Gatekeeper 提示。
- Android 用户需要确认安装 `.apk`。

不要把安装包版本清单的更新误当成前端资源发布。Electron 没有接入 `electron-updater`，APK 也没有静默安装能力。

## 自动发布注意事项

### 发布前

1. 确认前端改动已写入 `teacher-workbench/frontend/`，并递增 `frontend/update-manifest.json` 的 `version`。
2. 确认 `update-manifest.json.files` 包含每个新增或修改的前端资源；否则会产生新旧文件混用。
3. 发布安装包时同步检查：
   - 根目录 `package.json` 的 Electron 版本。
   - `android/app/build.gradle` 的 `versionName` 和 `versionCode`。
   - Release tag，例如 `v3.0.2`。
4. 若启用强制升级，确认 `force_update=true` 之前所有稳定下载地址均可访问。
5. 不提交 Android keystore；工作流只从 GitHub Actions Secrets 恢复签名文件。

### GitHub Actions 工作流实际行为

`.github/workflows/desktop-release.yml` 当前由手动 `workflow_dispatch` 触发：

- Windows Runner 构建 NSIS/portable Electron 包。
- macOS Runner 构建 DMG/ZIP Electron 包。
- Ubuntu Runner 构建签名 Android APK。
- 创建 GitHub Release。
- 将稳定安装包和动态生成的 `app-update.json` 上传到 R2。
- 将 `teacher-workbench/frontend/` 单独部署到 Cloudflare Pages，部署根目录不包含 `dist/` 安装包。

工作流需要以下 Secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

重要：当前工作流会自动发布安装包、R2 的 `app-update.json` 和 Pages 前端资源。Pages 步骤只部署
`teacher-workbench/frontend/`，不会上传 `dist/` 中的 `.exe`、`.apk`、`.dmg` 或其他安装包；发布前仍必须递增
`frontend/update-manifest.json` 的 `version` 并确认 `files` 完整。

### 发布后

1. 检查 Pages：`https://fff.xmoj-script.uk/update-manifest.json` 的版本和 `files` 是否正确。
2. 检查 R2：`https://fff-file-r2-cloudflare.xmoj-script.uk/app-update.json` 的平台版本、URL 和 `force` 是否正确。
3. 检查稳定对象名没有改变：
   - `teacher-workbench-windows.exe`
   - `teacher-workbench-macos.dmg`
   - `teacher-workbench-android.apk`
4. 在浏览器、已安装 Electron 和已安装 APK 各验证一次。
5. 重点验证：设置页版本号、手动检查更新、前端资源更新、安装包下载、macOS 首次打开提示。
6. 若看到旧文案或旧脚本，先确认清单版本已递增并已部署，再刷新页面/重启应用；必要时清理站点 Service Worker 缓存。
7. 遇到失败时保留旧安装包和旧前端清单，先恢复可用版本，再定位发布链路。

## 版本与数据安全

- `frontend/update-manifest.json` 的版本控制前端资源；R2 `app-update.json` 的版本控制安装包，二者必须分别核对。
- `force: true` 会锁定升级弹窗；只有在安装包、URL、签名和下载权限都确认正常时才能启用。
- 新的 D1 migration 必须同时检查本地和远程迁移顺序，避免直接修改生产表结构。
- 备份恢复会清空当前空间业务数据；涉及恢复、删除、回收站和租户归档的改动必须保留明确的二次确认和权限检查。
- AI 密钥只允许服务端保存，不在前端明文回显，也不写入日志。
- R2 上传、公开下载域名和 Worker CORS 配置变更后，必须验证权限边界和文件类型/大小限制。

## 完成标准

一个改动在以下条件满足后才算完成：

- 相关脚本无语法错误，编辑器诊断无新增错误。
- 新增文案覆盖三种语言。
- 前端和应用壳层的资源更新边界已核对。
- 若涉及发布，Pages 清单、R2 安装包清单和 Release 版本一致。
- 至少完成一次针对性运行验证；无法验证的部分必须在结果中明确说明。
