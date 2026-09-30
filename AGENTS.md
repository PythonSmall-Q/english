# AGENTS.md

## 项目概览

这是“英语教师教学工作台 V3”，由原生静态前端、Cloudflare Worker/D1/R2 后端和 Electron/Capacitor 应用壳组成。

- 前端：`teacher-workbench/frontend/`，原生 HTML/CSS/JS SPA，无前端构建步骤。
- 后端：`teacher-workbench/worker/`，Cloudflare Workers + Hono + D1 + R2。
- 桌面端：`desktop/main.cjs`、`desktop/preload.cjs`，Electron。
- Android：`android/`，Capacitor 7 + Gradle。
- HarmonyOS NEXT：`harmony next/`，ArkTS/ArkUI WebView 壳层；需要 DevEco Studio 和 HarmonyOS SDK。
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
- 构建产物（`dist/`、APK、EXE、DMG 等）默认只在本地生成和验证，不上传到 R2、Pages、GitHub Release 或其他发布服务；只有用户明确要求发布时才上传。
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
- HarmonyOS 签名证书、Profile、私钥和密码只允许保存在 DevEco 或 CI Secrets 中，不得提交到 `harmony next/`。

## 完成标准

一个改动在以下条件满足后才算完成：

- 相关脚本无语法错误，编辑器诊断无新增错误。
- 新增文案覆盖三种语言。
- 前端和应用壳层的资源更新边界已核对。
- 若涉及发布，Pages 清单、R2 安装包清单和 Release 版本一致。
- 至少完成一次针对性运行验证；无法验证的部分必须在结果中明确说明。

## 文件导航与重要函数

以下导航覆盖项目维护时会直接修改或定位的源码、配置和数据文件；`node_modules/`、`build/`、`dist/`、Gradle 中间产物、第三方 `vendor/` 文件和二进制资源不逐个展开。

### 根目录与发布配置

| 文件 | 概要 | 重要位置 |
| --- | --- | --- |
| `package.json` | Electron、Capacitor、Wrangler 依赖与构建脚本 | `desktop:dev`、`desktop:dist:win`、`desktop:dist:mac`、`mobile:sync`、`mobile:apk`；`build` 打包配置 |
| `package-lock.json` | 根目录 npm 依赖锁定 | 根包版本与依赖树 |
| `capacitor.config.json` | Capacitor 应用标识和 Web 资源目录 | `appId`、`webDir` |
| `AGENTS.md` | 本项目协作、发布和文件导航规则 | 本节及前文约束 |
| `英语教师教学工作台 V3 完整产品与技术设计文档.md` | 产品、数据和技术设计基线 | 需求与数据模型参考，不直接作为运行时代码 |
| `.github/workflows/desktop-release.yml` | 手动发布 Windows、macOS、Android、R2 和 Pages | `workflow_dispatch`；桌面/Android 构建；R2 `app-update.json` 生成与上传 |

### 前端入口与公共模块

目录：`teacher-workbench/frontend/`。这是无构建步骤的原生 HTML/CSS/JS SPA。

| 文件 | 概要 | 重要位置 |
| --- | --- | --- |
| `index.html` | SPA HTML 壳、登录区和工作台区 | `#auth-screen`、`#app-frame`、`#view-container`；`data-view` 导航 |
| `styles.css` | 全局布局、主题、表格、弹窗和响应式样式 | CSS 变量、`.hidden`、`.modal-*`、`.view-container` |
| `app.js` | 全局 `App` 状态、路由、租户切换、弹窗和公共 UI | `App.boot()`、`App.showView()`、`App.setTenant()`、`App.routeFromLocation()`、`App.esc()`、`App.toast()`、`App.showDeviceModePicker()`、`App.isAndroidApp()` |
| `api.js` | 统一 API 客户端和租户请求头 | `resolveBase()`、`request(path, options)`；`api.*` 命名空间 |
| `auth.js` | 登录、注册、退出和会话恢复 | `App.showAuthScreen(mode)`、登录/注册表单绑定 |
| `landing.js` | 未登录首页、功能、定价和下载入口 | `LANDING_FEATURES`、`LANDING_PRICING`、`LANDING_COMPARE`、`App.showLanding()` |
| `i18n.js` | `zh-CN`、`zh-TW`、`en` 文案与格式化 | `I18n.t(key, locale)`、`I18n.format(template, vars)` |
| `dict.js` | 词典资源加载和浮动词典 | 词典数据加载、查询和 `DictFloat.mount()` |
| `update.js` | 独立应用版本检查和 Android 前端资源更新 | `compareVersions()`、`platform()`、`localVersion()`、`App.checkForUpdates()`、`updateAndroidFrontend()` |
| `sw.js` | Service Worker 缓存和远程前端资源更新 | 安装/激活/`fetch`；`UPDATE_REMOTE_CACHE` 消息处理 |
| `app-update.json` | R2 安装包版本、下载地址和强制更新标记 | `platforms.windows`、`platforms.macos`、`platforms.android` |
| `update-manifest.json` | Pages 前端资源版本和文件清单 | `version`、`files[]` |
| `_headers` | Cloudflare Pages 响应头 | 缓存、CORS 和安全头配置 |
| `favicon.svg` | 浏览器和安装包图标资源 | 静态资源 |
| `assets/dict-featured.json` | 精选词典数据 | 由 `dict.js` 加载 |
| `assets/dict-gaokao.json` | 高考词典数据 | 由 `dict.js` 加载 |
| `assets/wechat-qr.png` | 联系二维码 | 落地页静态资源 |
| `vendor/xlsx.full.min.js` | XLSX 导入/导出第三方库 | 学生、成绩和数据导入功能 |
| `vendor/katex/` | KaTeX 数学公式资源 | 教案、题目和富文本公式渲染 |
| `vendor/vditor/` | Vditor 编辑器资源 | 教案 Markdown 编辑和预览 |

### 前端业务视图

目录：`teacher-workbench/frontend/views/`。每个视图通常通过 `App.registerView()` 注册 `render()` 和 `init()`。

| 文件 | 概要 | 重要位置 |
| --- | --- | --- |
| `dashboard.js` | 工作台首页、课表、待办和作业概览 | `DASH_ACTIONS`、首页统计渲染、快捷入口 |
| `lessons.js` | 教案、Markdown/LaTeX 编辑和素材 | 教案 CRUD、Vditor 初始化、导出与预览 |
| `schedule.js` | 班级课表和节次安排 | 课表加载、节次编辑、周视图渲染 |
| `classes.js` | 班级 CRUD、学年和任课教师 | 班级表单、学年切换、教师分配 |
| `students.js` | 学生 CRUD、批量导入、成绩/作业摘要 | XLSX 导入、学生详情和批量操作 |
| `assignments.js` | 作业布置、提交登记和统计 | 作业 CRUD、提交率、指定学生/豁免学生处理 |
| `dictations.js` | 默写、结果登记、重默和名单图片 | 默写 CRUD、结果批量登记、图片导出 |
| `exams.js` | 考试、题目小分、排名和趋势 | 成绩录入、统计图表、成绩导入导出 |
| `ai.js` | AI 会话和流式回复实现，当前入口可隐藏 | 会话加载、新建会话、消息流处理；保留 AI API 调用代码 |
| `todos.js` | 待办创建、完成、归档和提醒 | 待办 CRUD、状态切换、优先级 |
| `admin.js` | 平台设置、用户、租户、套餐和配额 | `setupAdminSections()`、平台设置、用户/租户管理、迁移入口 |
| `quota.js` | 空间和成员资源配额 | 空间配额加载、成员配额编辑、使用量表格 |
| `recycle.js` | 回收站列表、恢复和永久删除 | 回收站加载、恢复、二次确认和清理 |
| `settings.js` | 个人设置、语言、设备模式和版本检查 | 设置保存、`check-app-update`、设备方向选择 |

### Worker 核心模块

目录：`teacher-workbench/worker/src/`。

| 文件 | 概要 | 重要导出/函数 |
| --- | --- | --- |
| `index.js` | Hono Worker 入口、路由挂载、CORS 和定时任务 | `app`、`fetch`、`scheduled`；`/api/v1/*` 路由注册 |
| `middleware.js` | 认证、租户、角色、细粒度权限和审计 | `requireAuth()`、`requireTenant()`、`requireRole()`、`requireClassManager()`、`requireTeacherPerm()`、`canManageClass()`、`audit()` |
| `db.js` | ID、时间、学年和统一错误响应 | `newId()`、`now()`、`currentAcademicYear()`、`resolveAcademicYear()`、`ApiError`、`errorResponse()` |
| `auth-core.js` | PBKDF2 密码、Session 和平台管理员判定 | `resolvePlatformRole()`、`hashPassword()`、`verifyPassword()`、`newSessionToken()`、`getSessionUser()` |
| `archive.js` | 学年归档和压缩 payload | `ARCHIVE_MODULES`、`previousAcademicYear()`、`isRemindWindow()`、`gzipText()`、`archiveAllTenants()` |
| `rollover.js` | 学年结转和毕业班迁移 | `rolloverTenants()`、`graduateClass()` |
| `trial.js` | 试用空间清理 | `purgeExpiredTrials()` |
| `recycle.js` | 回收站定期物理清理 | `purgeRecycleBin()` |
| `quota.js` | 租户/用户配额计算与限制 | 配额读取、使用量统计、限额检查 |
| `branding.js` | 平台品牌配置 | 品牌配置读取和更新 |
| `cfai.js` | Cloudflare Workers AI 集成 | 模型调用、请求转换和 AI 结果处理 |

### Worker API 路由

目录：`teacher-workbench/worker/src/routes/`。路由文件负责 HTTP 参数校验、权限中间件和业务调用。

| 文件 | 主要端点/职责 |
| --- | --- |
| `auth.js` | `/auth/register`、`/auth/login`、`/auth/logout`、`/auth/me` |
| `tenants.js` | 租户、成员、邀请和租户切换 |
| `classes.js` | 班级 CRUD 和学年筛选 |
| `students.js` | 学生 CRUD、批量导入和详情 |
| `assignments.js` | 作业、提交和提交统计 |
| `dictations.js` | 默写、结果和重默 |
| `exams.js` | 考试、成绩、小分和排名 |
| `lessons.js` | 教案 CRUD 和跨学年访问 |
| `schedules.js` | 课表和节次 |
| `dashboard.js` | 首页汇总统计 |
| `ai.js` | AI 会话、消息和流式生成；后端代码保留 |
| `files.js` | R2 文件上传、下载和元数据 |
| `import.js` | 班级/学生等批量导入 |
| `export.js` | 数据导出和 XLSX 生成 |
| `admin.js` | 平台用户、租户、配额和设置 |
| `grade-groups.js` | 年级组/备课组 |
| `graduated.js` | 毕业班数据查看和下载 |
| `archive.js` | 学年归档列表、查看和下载 |
| `recycle.js` | 回收站查询、恢复和删除 |
| `todos.js` | 待办 CRUD |
| `trial.js` | 试用租户注册 |
| `brandimg.js` | 品牌图片上传、读取和删除 |

### Worker 配置、迁移和脚本

| 路径 | 概要 |
| --- | --- |
| `teacher-workbench/worker/package.json` | Worker 依赖和 Wrangler 脚本 |
| `teacher-workbench/worker/wrangler.toml` | Worker、D1、R2、环境变量和 Cron 配置 |
| `teacher-workbench/worker/migrations/` | 主业务库按序迁移；新增 schema 必须新建编号 SQL，不修改已发布迁移 |
| `teacher-workbench/worker/grad-migrations/` | 毕业班归档库迁移 |
| `teacher-workbench/worker/trial-migrations/` | 试用空间库迁移 |
| `teacher-workbench/scripts/smoke-test.mjs` | Worker/API 冒烟测试 |
| `teacher-workbench/tools/convert-legacy-backup.mjs` | 旧备份转换 |
| `teacher-workbench/tools/unarchive.mjs` | 归档解压和恢复辅助工具 |
| `teacher-workbench/tools/解压归档.html` | 浏览器端归档解压工具 |
| `teacher-workbench/tools/xlsx.full.min.js` | 工具目录使用的 XLSX 依赖副本 |

### Electron 桌面端

| 文件 | 概要 | 重要位置 |
| --- | --- | --- |
| `desktop/main.cjs` | Electron 主进程、单实例、窗口和远程前端覆盖更新 | `createWindow()`、`updateFrontend()`、`isNewerVersion()`；`ipcMain.handle('get-app-version')`、`open-external`、`save-file` |
| `desktop/preload.cjs` | context isolation 预加载桥 | `window.WB_RUNTIME`；`apiBase`、`platform`、`appVersion`、`getAppVersion()`、`openExternal()`、`saveFile()` |

### Android / Capacitor

| 文件或目录 | 概要 | 重要位置 |
| --- | --- | --- |
| `android/app/build.gradle` | Android 包名、SDK、签名、`versionCode` 和 `versionName` | `android.defaultConfig`、`buildTypes.release` |
| `android/app/src/main/AndroidManifest.xml` | Android 应用、权限和 Activity 声明 | `MainActivity`、应用权限 |
| `android/app/src/main/java/cn/xmoj/teacherworkbench/MainActivity.java` | Capacitor Android 入口 | `MainActivity extends BridgeActivity` |
| `android/app/src/main/res/layout/activity_main.xml` | 原生 Activity 布局 | 主容器布局 |
| `android/app/src/main/res/values/` | 应用名称、主题和图标背景 | `strings.xml`、`styles.xml` |
| `android/app/src/main/res/drawable*`、`mipmap*` | 启动画面和应用图标 | 各密度/横竖屏资源 |
| `android/app/src/main/res/xml/` | 文件共享和网络安全配置 | `file_paths.xml`、`network_security_config.xml` |
| `android/gradlew*`、`android/gradle/` | Gradle Wrapper | `gradlew.bat`、Wrapper 版本配置 |
| `android/variables.gradle`、`android/capacitor.build.gradle` | Capacitor/Android 版本和构建公共配置 | SDK、依赖版本 |
| `android/keystore.properties`、`android/local.properties` | 本机签名和 SDK 路径配置 | 不提交密钥、密码或本机路径 |

### HarmonyOS NEXT

| 文件 | 概要 | 重要位置 |
| --- | --- | --- |
| `harmony next/entry/src/main/ets/entryability/EntryAbility.ets` | HarmonyOS Ability 入口和窗口生命周期 | `onCreate()`、`onWindowStageCreate()`、`onWindowStageDestroy()`、`onForeground()`、`onBackground()` |
| `harmony next/entry/src/main/ets/pages/Index.ets` | ArkUI WebView 页面容器 | 页面构建、WebView 加载和返回处理 |
| `harmony next/entry/src/main/module.json5` | Ability、权限和模块声明 | `abilities`、`requestPermissions` |
| `harmony next/entry/src/main/resources/` | 应用名称、图标和页面路由资源 | `string.json`、`main_pages.json`、`app_icon.svg` |
| `harmony next/entry/oh-package.json5` | Entry 模块依赖 |
| `harmony next/oh-package.json5` | HarmonyOS 工程依赖 |
| `harmony next/build-profile.json5` | 构建、签名和产品配置 |
| `harmony next/hvigorfile.ts` | Hvigor 构建脚本 |

### 维护时的定位顺序

1. 用户界面或交互：先看 `frontend/index.html`、`app.js` 和对应 `views/*.js`。
2. 数据请求或权限：先看 `frontend/api.js`，再看 Worker 对应 `routes/*.js` 和 `middleware.js`。
3. 数据结构：先看最新相关 `migrations/*.sql`，再修改业务路由；不要直接改已发布迁移。
4. 安装包或前端更新：分别核对 `package.json`/`android/app/build.gradle`、`app-update.json` 和 `update-manifest.json`。
5. 构建产物默认只本地生成和验证，不上传；发布前必须得到用户明确授权。
