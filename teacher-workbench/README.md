# 英语教师教学工作台 V3

面向英语教师的一体化教学工作台：班级与学生管理、备课中心、教学课表、作业统计、默写管理、考试成绩分析（含小分与个性化报告）、AI 教学助手、数据导入导出与备份恢复。

- 后端：`worker/` — Cloudflare Workers（Hono）+ D1（SQLite）
- 前端：`frontend/` — 原生 HTML/CSS/JS 单页应用（无构建步骤）
- 完整设计见仓库根目录《英语教师教学工作台 V3 完整产品与技术设计文档.md》

## 目录结构

```
teacher-workbench/
├── frontend/            # 前端 SPA（静态文件，任意静态服务器可托管）
│   ├── index.html       # 入口（引入 vendor/xlsx 与全部视图）
│   ├── app.js / api.js / auth.js / styles.css
│   ├── vendor/xlsx.full.min.js   # SheetJS（全项目仅此一份）
│   └── views/           # 12 个视图模块（dashboard/classes/lessons/schedule/
│                        #   students/assignments/dictations/exams/ai/settings/admin）
├── worker/              # Cloudflare Worker 后端
│   ├── src/
│   │   ├── index.js     # Hono 入口：/api/v1 前缀、CORS、路由挂载、统一错误格式
│   │   ├── auth-core.js / middleware.js / quota.js / db.js
│   │   └── routes/      # auth/tenants/classes/students/lessons/schedules/
│   │                    #   assignments/dictations/exams/dashboard/ai/files/import/export/admin
│   ├── migrations/      # D1 迁移（0001_init … 0008_user_admin_quota：user_quotas 按用户配额 + memberships.updated_at）
│   └── wrangler.toml
└── scripts/
    └── smoke-test.mjs   # 端到端冒烟测试（Node 18+，需先启动本地后端）
```

## 本地启动

要求 Node 18+，首次运行先安装依赖：

```bash
cd worker
npm install          # 安装 hono / wrangler

# 初始化本地 D1（仅首次，或 schema 变更后）
npx wrangler d1 migrations apply DB --local

# 启动后端（默认 http://localhost:8787）
npx wrangler dev --local --port 8787
```

前端无任何构建步骤，用任意静态服务器托管 `frontend/` 即可（示例）：

```bash
cd frontend
npx serve .          # 或 node/python 任意静态服务器，如 http://localhost:3000
```

前端会根据当前 hostname 自动推导 API 地址：localhost/127.0.0.1 → `http://localhost:8787/api/v1`，
其余走同源 `/api/v1`；也可用 `localStorage.API_BASE` 覆盖。

## 独立应用（Windows / macOS / Android）

仓库根目录已提供跨平台应用壳层：桌面端使用 Electron，Android 使用 Capacitor；业务前端仍共用本目录的静态 SPA。

```bash
# 根目录安装依赖
npm install

# 桌面开发运行（默认连接生产 API；本地开发可设置 WB_API_BASE）
$env:WB_API_BASE = 'http://localhost:8787/api/v1' # PowerShell
npm run desktop:dev

# 生成 Windows 安装包 / 便携版
npm run desktop:dist:win

# 在 macOS 上生成 DMG / ZIP
npm run desktop:dist:mac

# Android：需安装 Android Studio、SDK 和 JDK 17+
npm run mobile:open       # 在 Android Studio 中打开
npm run mobile:apk        # 生成 android/app/build/outputs/apk/release/app-release.apk
```

### GitHub Actions 桌面版发布

工作流 `.github/workflows/desktop-release.yml` 支持手动触发，会在 Windows 和 macOS Runner
上分别构建未签名安装包，并构建签名 Android APK，最后创建 GitHub Release。进入仓库的 **Actions → Desktop Release → Run workflow**，
填写版本标签（例如 `v3.0.0`）即可。

运行前在仓库 **Settings → Secrets and variables → Actions** 配置 Android 签名 Secrets：

- `ANDROID_KEYSTORE_BASE64`：`android/teacher-workbench-release.jks` 的 base64 内容
- `ANDROID_KEYSTORE_PASSWORD`：keystore 密码
- `ANDROID_KEY_ALIAS`：签名别名
- `ANDROID_KEY_PASSWORD`：签名密码

工作流使用同一 keystore 构建 `app-release.apk` 并上传到 Release。不要把 `.jks` 或密码提交到仓库。

桌面应用通过 `WB_API_BASE` 注入 API 地址，未设置时使用生产 API。Android 构建使用
`capacitor.config.json` 的 `webDir` 直接打包 `frontend/`，如需本地 Worker，请在设备可访问的地址上配置 API
覆盖（不能使用 Android 模拟器不可达的 `localhost`）。应用包名为 `cn.xmoj.teacherworkbench`。

### 版本更新与发布注意事项

项目有两套独立的更新机制，修改前端代码和发布安装包时必须分别维护对应清单。

#### 1. 前端资源在线更新

- 浏览器和 APK 使用 `frontend/sw.js` 的 Service Worker 缓存前端资源。
- Electron 不使用 Service Worker，而是在启动窗口前由 `desktop/main.cjs` 检查远程清单并覆盖前端资源。
- 前端更新清单是 `frontend/update-manifest.json`，默认部署在 Pages 的
  `https://fff.xmoj-script.uk/update-manifest.json`。
- 修改 HTML、JS、CSS 或静态资源后，必须递增清单中的 `version`，并把修改过的文件加入 `files`。
- `files` 应包含完整的前端程序文件，尤其是 `index.html`、`i18n.js`、`app.js`、`update.js`、
  `styles.css` 和对应的 `views/*.js`；否则 Electron 覆盖目录可能混用新旧资源。
- 必须先部署 Pages，再启动 APK 或 Electron 验证更新。版本号不变时，客户端会认为无需更新。
- APK 的 Service Worker 可能先返回现有缓存，后台更新资源，通常在下一次刷新或重新打开后完全生效。
- Electron 会在启动时等待远程资源下载；网络不可用或下载失败时继续使用本地内置版本。
- 前端在线更新只替换 HTML/JS/CSS/静态资源，不会更新原生代码、Electron 主进程、Android 权限或数据库。

#### 2. 安装包版本更新

- 安装包版本清单是 R2 上的 `app-update.json`，地址为
  `https://fff-file-r2-cloudflare.xmoj-script.uk/app-update.json`。
- `platforms.windows`、`platforms.macos`、`platforms.android` 分别对应 Electron Windows、Electron macOS 和 APK。
- Electron 与 APK 共用 `frontend/update.js` 的版本检查逻辑：发现新安装包后弹窗并打开下载地址。
- 当前是“下载提示”模式，不是静默安装：Windows 用户需要运行 `.exe`，Android 用户需要确认安装 `.apk`。
- Electron 尚未接入 `electron-updater`，因此不会在后台自动替换自身；APK 也不能绕过系统确认自动安装。
- `force: true` 会锁定升级弹窗，适合阻止旧版本继续使用；启用前必须确认安装包 URL 可访问。

#### 3. 发布检查清单

1. 仅发布前端改动：递增 `frontend/update-manifest.json` 的 `version`，检查 `files`，部署 Pages。
2. 发布新安装包：同步更新 `package.json`、`android/app/build.gradle` 的版本信息，并通过
   `Desktop Release` 工作流创建对应的 Release tag，例如 `v3.0.2`。
3. 确认工作流已将安装包和新的 `app-update.json` 上传到 R2；稳定下载地址不能改名：
   `teacher-workbench-windows.exe`、`teacher-workbench-macos.dmg`、`teacher-workbench-android.apk`。
4. 检查 Pages 的 `update-manifest.json` 与 R2 的 `app-update.json`：前者控制前端资源，后者控制安装包版本，不能混用。
5. 在浏览器、已安装 Electron 和已安装 APK 各验证一次；重点检查设置页版本号、更新按钮、下载地址和 macOS 首次打开提示。
6. 如果出现旧资源混用，先确认清单版本已递增，再刷新页面或重启应用；必要时清除站点 Service Worker 缓存后重新打开。

Worker 已接入 D1 Sessions API。启用 Global Read Replication 后，API 会按数据库 binding
（主库、试用库、归档库）分别维护 session bookmark；前端 API Client 会自动透传并保存 bookmark，
保证跨请求的顺序一致性。旧版客户端不携带 bookmark 时仍会从 `first-unconstrained` 开始会话。

## 首次使用流程

1. 打开前端页面，「注册」账号（邮箱 + 至少 8 位密码）。
2. 注册后系统自动创建个人空间「{昵称}的空间」，你是该空间的 owner。
3. 个人空间默认配额：班级 2 个、学生 100、AI 20 次/月（§19 个人版）。
   需要更多：请平台管理员创建正式组织空间并邀请你加入。
4. 在「我的班级」创建班级 →「设置 → 数据导入」批量导入班级学生名单
   （支持 .xlsx / .csv / .json / 粘贴，班级名在 tenant 内匹配，未匹配行会明确返回）。
5. 开始使用：备课中心、教学课表、作业统计、默写管理、考试成绩、AI 教学助手。

数据导出与备份恢复在「设置」页：备份为 JSON（`version: 3`），恢复是
**先清空当前空间全部业务数据再按备份写入**（事务性，owner/admin 可用），
且只允许恢复到备份来源的同一空间（禁止跨租户恢复）。

## AI 配置

每个用户可在「设置 → AI 助手设置」里填写自己的 API 端点 / 密钥 / 模型，
配置存数据库（`user_ai_settings` 表，密钥服务端保存、前端只回显掩码）。
Provider 选择优先级：**用户自配 > 环境变量 > 内置演示回复**。

```bash
# worker/.dev.vars（可选：平台级默认 Provider，本地开发用，勿提交真实密钥到仓库）
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

浏览器不直连 AI Provider，全部经 Worker 代理（OpenAI 兼容 `/chat/completions` 接口，30 秒超时）。
点「恢复内置演示」清除个人配置后回退到环境变量或内置 mock（响应中 `mock: true`）。
AI 不限制请求次数，仅按 Credit 实际消耗扣减；1 Credit = $0.01。基础版/个人空间每月 10 Credit，专业版每月 100 Credit，学校版每月 500 Credit。

## 平台管理员

环境变量 `PLATFORM_ADMIN_EMAILS`（逗号分隔邮箱），匹配的用户在注册/登录时
自动获得 `platform_role = 'platform_admin'`，可访问「平台管理」视图：

- 查看/管理全部租户（创建正式组织空间、启用/停用：POST `/admin/tenants/:id/status`，
  body `{ status: 'active' | 'disabled' }`）
- 调整租户配额（PUT `/admin/tenants/:id/quota`）
- 查看全部用户；设置/取消平台管理员（PATCH `/admin/users/:id`，body `{ platformRole }`，
  不能取消自己、至少保留一个平台管理员；数据库中已有的平台管理员登录时不会被降级）
- `PLATFORM_ADMIN_EMAILS` 变化不会降级：env 命中 **或** 库中已是 `platform_admin` 均保持平台管理员

```bash
# worker/.dev.vars 或 wrangler.toml [vars] / 部署时 wrangler secret/vars
PLATFORM_ADMIN_EMAILS="admin@example.com,ops@example.com"
```

## 成员移除、按用户配额与数据清除

- **移除成员**（DELETE `/tenants/:id/members/:userId`，owner/admin）：软删除
  （memberships.status='removed'），数据保留；admin 不能移除 owner 角色成员，
  最后一个 active owner 受保护。被移除成员可通过「添加账户」或邀请链接重新加入，
  成员资格与原有数据自动恢复。
- **配额明细**（GET `/tenants/:id/quota-detail`，owner/admin）：每个成员
  （含已移除）的教案/作业/默写/文件/AI 本月用量、存储字节与按用户配额覆盖，
  以及租户总用量（getQuotaUsage）。
- **按用户配额**（PUT `/tenants/:id/members/:userId/quota`，owner/admin）：
  body `{ resource: lessons|assignments|dictations|ai|files, quota: ≥0 整数 | null }`，
  UPSERT 进 `user_quotas`；`null` 删除覆盖。创建教案/作业/默写、AI 生成时按用户归属列
  计数优先裁决，无覆盖时走租户配额。
- **清除数据**（POST `/tenants/:id/members/:userId/purge`，owner/admin）：
  仅允许对已移除成员，硬删除其在本空间的教案/作业/默写（先删提交/结果子表）、
  文件（含 R2 对象）、AI 生成记录，并把 classes.teacher_id 置 NULL、删除
  class_teachers 行。可选 body `{ resources: [...] }` 指定资源子集；
  **不可恢复**，重新加入不会恢复已清除的数据。

## 部署

```bash
cd worker
wrangler login
# 创建生产 D1 并把 wrangler.toml 里的 database_id 换成新库 ID
wrangler d1 create teacher-workbench
# 应用迁移到生产库
npx wrangler d1 migrations apply DB --remote
# 部署 Worker（同时配置 ALLOWED_ORIGINS / PLATFORM_ADMIN_EMAILS / AI_* 等变量）
wrangler deploy
```

前端托管到 Cloudflare Pages（或任意静态托管）：构建命令留空、输出目录为 `frontend/`。
部署后在 Pages 上把前端域名加入 Worker 的 `ALLOWED_ORIGINS`（CORS 白名单，生产禁 `*`），
前端默认走同源 `/api/v1`；如前后端不同域，在前端页面控制台设置
`localStorage.API_BASE = 'https://<worker域名>/api/v1'`。

Electron 启动时会检查 `https://fff.xmoj-script.uk/update-manifest.json`。当清单版本高于安装包时，
会自动下载清单中的前端程序文件到用户数据目录并从覆盖目录启动；网络不可用时继续使用本地版本。
发布前请更新 `frontend/update-manifest.json` 的 `version`，并确保 `files` 包含完整前端程序文件。
该机制只更新 HTML/JS/CSS/静态资源，不覆盖登录信息、业务数据或用户设置。

GitHub Actions 的 `Desktop Release` 工作流在创建 Release 后会自动把 Windows 安装包、macOS DMG、Android APK
和动态生成的 `app-update.json` 上传到 R2。工作流需要配置仓库 Secrets：`CLOUDFLARE_API_TOKEN`
（需要 R2 写入权限）和 `CLOUDFLARE_ACCOUNT_ID`。手动运行工作流时，`force_update=true` 会让客户端强制升级。
安装包统一使用 `teacher-workbench-windows.exe`、`teacher-workbench-macos.dmg`、`teacher-workbench-android.apk`
三个 R2 对象名；版本号从 Release tag（如 `v3.0.1`）自动去掉 `v` 得到。

## R2 文件存储

文件上传已接入 R2（§44-46）：Worker 经 `FILES` binding 直写 bucket `fff`，
D1 `files` 表存元数据，下载走 bucket 公共分发域名（`PUBLIC_FILE_BASE`，
当前为 `https://fff-file-r2-cloudflare.xmoj-script.uk`，上传后拼 `file_key` 即为下载 URL）。

- 端点：`POST /files`（二进制 body + `X-File-Name` 头，≤50MB）、`GET /files`、
  `GET /files/:id`、`DELETE /files/:id`
- 已接入的业务：考试「上传试卷」（存 `paper_url`）、默写「上传材料」（存 `material_url`）、
  AI 助手「上传附件」（链接附在提示词中）
- 环境缺少 `FILES` binding 时自动回退 `501 R2_DEVELOPING`

## 已知限制

- 备份恢复单批事务上限为 D1 batch 的 1000 条语句；超过时按块提交，
  不再保证整体原子性（恢复前请保留好备份文件）。
- 审计日志、AI 生成记录、邀请不在备份范围内（恢复不覆盖它们）。

## 冒烟测试

后端启动后运行（真实 HTTP 全流程断言，覆盖注册/隔离/权限/配额/恢复等 32 项）：

```bash
node scripts/smoke-test.mjs        # API_BASE 环境变量可覆盖目标地址
```
