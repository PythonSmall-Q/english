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
│   ├── migrations/      # D1 迁移（0001_init.sql）
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
AI 用量按租户配额 `max_ai_requests_month` 限制（个人空间默认 20 次/自然月）。

## 平台管理员

环境变量 `PLATFORM_ADMIN_EMAILS`（逗号分隔邮箱），匹配的用户在注册/登录时
自动获得 `platform_role = 'platform_admin'`，可访问「平台管理」视图：

- 查看/管理全部租户（创建正式组织空间、启用/停用：POST `/admin/tenants/:id/status`，
  body `{ status: 'active' | 'disabled' }`）
- 调整租户配额（PUT `/admin/tenants/:id/quota`）
- 查看全部用户

```bash
# worker/.dev.vars 或 wrangler.toml [vars] / 部署时 wrangler secret/vars
PLATFORM_ADMIN_EMAILS="admin@example.com,ops@example.com"
```

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
