# Website Change Monitor — 环境审计与实施设计

## A. 环境审计结果

| 项目 | 结果 |
|---|---|
| 工作区 | 空仓库（仅 .git，main 无提交），remote 已指向 github.com/taozhihaoo/website-change-monitor |
| Node.js | **v24.19.0**（2026-09 为 Active LTS）|
| npm | 随 Node 附带（plan mode 拦截了 npm 命令，实施第一步实测确认）|
| pnpm | 同上未能检测；项目使用 npm workspaces，不依赖 pnpm |
| TypeScript | 作为项目 devDependency 固定版本，不依赖全局 |
| Git | 可用 |
| Docker | plan mode 下无法执行 docker 命令；实施第一步实测。若不可用将如实说明（不伪造构建结果），Dockerfile/compose 仍交付 |
| 平台 | Windows x64 / Git Bash —— 所有 npm scripts 写成跨平台 Node 脚本，不用 unix-only 语法 |

Node LTS 现状（2026-09）：24 = Active LTS，22 = Maintenance，20 已于 2026-04 EOL → **CI matrix 用 22 + 24**。

## 关键技术决策（文档已授权的裁量，请一并确认）

1. **调度器：自研轻量 tick-loop（约 150 行）**，不用 node-cron。每个 monitor 的间隔是任意分钟数而非 cron 表达式；tick-loop 每次从 DB 推导到期任务 → 服务重启零恢复逻辑、可注入时钟、测试更容易。
2. **通知 v1 = WebhookNotifier + MockNotifier + 完整 Provider 抽象；Email/SMTP 进 Roadmap**（文档明确允许），避免 SMTP 测试复杂度，保持 "small but complete"。
3. **结构：根目录 = server，client/ 为 workspace 的双包仓库**（npm workspaces，不引入 monorepo 工具链）。生产环境 Fastify 直接托管 client 构建产物 → 单容器单进程。
4. **SQLite 驱动：better-sqlite3**（同步 API、内建事务、Win/Linux/macOS 预编译二进制）。
5. **TypeScript NodeNext + ESM，strict 全开**；开发用 tsx，构建用 tsc；zod 校验；pino 日志（redact secrets）；diff 用 `diff`(jsdiff)。
6. **text 选择器语义**：提取 `<body>` 文本中包含该关键词的行集合；无匹配 → 明确报 `TEXT_NOT_FOUND`。
7. **幂等（严格按文档）**：`UNIQUE(monitor_id, current_hash)` —— 同一内容哈希只产生一次 ChangeEvent。副作用 A→B→A 时恢复不生成事件（写入 README Limitations）。
8. run-now 允许对 disabled monitor 手动触发（trigger=manual）；调度器只自动跑 enabled。

## B. 项目结构

```
website-change-monitor/
├── package.json            # 根=server；workspaces:["client"]；dev/build/test/lint/check/demo
├── tsconfig.json  .env.example  .gitignore  .nvmrc(24)
├── Dockerfile  docker-compose.yml  .dockerignore
├── .github/workflows/ci.yml
├── src/
│   ├── config/env.ts       # zod 校验 APP_PORT/DB_PATH/LOG_LEVEL/BROWSER_HEADLESS/
│   │                       #   MAX_CONCURRENT_CHECKS(5)/DEFAULT_TIMEOUT(30s) 等
│   ├── api/                # fastify 实例、统一错误处理、routes/(health|monitors|extraction)
│   ├── domain/             # 实体类型 + AppError 错误体系（error_code 体系）
│   ├── services/           # monitor-service(CRUD) check-service(核心管线)
│   │                       # extraction-service diff-service normalize notification-service
│   ├── repositories/       # 5 个仓储，全部 parameterized SQL
│   ├── browser/            # browser-manager：单例 Chromium + 每检查独立 context/page
│   ├── scheduler/          # scheduler.ts(tick-loop) queue.ts(有界并发队列)
│   ├── notifications/      # provider 接口 + webhook-notifier + mock-notifier
│   ├── db/                 # database.ts migrate.ts migrations/0001_init.sql
│   ├── utils/              # hash(SHA-256) url-guard logger clock id
│   └── index.ts
├── client/                 # React + Vite + TS：src/{api,pages,components,types}
└── fixtures/               # site-v1.html($99) site-v2.html($89) 离线演示
```

## C. 模块职责

- **BrowserManager**：懒启动单个 Chromium；每次检查 newContext/newPage（隔离），用完即关；崩溃自动重启；停机优雅销毁。绝不每 monitor 一个浏览器。
- **check-service（核心管线）**：URL 安全校验 → 提取 → normalize（trim/CRLF→LF/折叠空白/去空行）→ SHA-256 → 与上一快照比对：首次=存 baseline（不发通知）；相同=unchanged；不同=存快照+ChangeEvent（UNIQUE 幂等）→ 异步通知（失败不影响 check 结果）→ 每次必写 check_run（status: baseline|unchanged|changed|error + error_code + safe_message + duration_ms）。
- **url-guard**：仅 http/https；拒绝 localhost/*.local/127/8/0.0.0.0/::1/10/8/172.16/12/192.168/16/169.254/16/IPv6 回环与私网。创建、更新、每次 check 前都校验。不做 DNS 级防护（Limitation）。README 声明：仅用于有权访问的公开/授权页面。
- **notifications**：`NotificationProvider{name,send()}`；WebhookNotifier POST 文档指定 JSON payload，超时 8s，5xx/网络错误重试≤3 次（退避；测试可注入），4xx 不重试；delivery 记录 attempts/status；webhook URL 脱敏存储（只存 origin）。
- **scheduler**：每 10s tick → 查 enabled 且到期（now ≥ last_check + interval，失败也计间隔防失败风暴）→ 未在 inflight 的进有界队列（并发=MAX_CONCURRENT_CHECKS）；单任务异常隔离；GET /scheduler/status 暴露 active/queued；停机：停 tick→等 inflight→关浏览器→关 DB；重启无恢复逻辑（状态全在 DB）。
- **db**：编号 SQL migrations + schema_migrations 表；数据库异常包装为内部错误，不泄漏 SQL。
- **api**：zod 校验（ZodError→400 统一格式）；404 专用 handler；全局 error handler 不返回 stack；路由零业务逻辑。

## D. 数据模型（SQLite，全部 ON DELETE CASCADE）

- **monitors**: id(uuid) name url selector selector_type(css|xpath|text) check_interval_seconds(≥60) enabled webhook_url? created_at updated_at
- **snapshots**: id monitor_id content_hash content checked_at
- **change_events**: id monitor_id previous_hash current_hash previous_content current_content diff_json detected_at — **UNIQUE(monitor_id,current_hash)**
- **check_runs**: id monitor_id trigger(schedule|manual|test) status(baseline|unchanged|changed|error) error_code? error_message? duration_ms started_at finished_at
- **notification_deliveries**: id change_event_id provider target(脱敏) status(sent|failed) attempts last_error? created_at updated_at
- **schema_migrations**: version applied_at

## E. API 设计（Fastify）

```
GET  /health                      200
GET  /scheduler/status            200  active/queued
GET  /monitors                    200  含 last_check/last_change/next_check 汇总
POST /monitors                    201/400  zod+URL 安全校验
GET  /monitors/:id                200/404  含最新快照
PATCH /monitors/:id               200/400/404
DELETE /monitors/:id              204/404
POST /monitors/:id/run            202{run_id}/404；?wait=1 同步等结果（调试/演示）
GET  /monitors/:id/runs           200/404  分页
GET  /monitors/:id/changes        200/404  含 diff
POST /monitors/:id/test-notification  200/502
POST /monitors/test-extraction    200{content,hash,duration_ms}/422{error_code}
                                  保存前试提取，不持久化任何 snapshot/event
```
统一错误：`{"error":{"code":"MONITOR_NOT_FOUND|VALIDATION_ERROR|URL_NOT_ALLOWED|EXTRACTION_FAILED|INTERNAL","message":...}}`；内部错误只回 "Internal server error"+requestId，无 stack。

## F. 调度设计
见 C。UI 预设 5m/15m/30m/1h/6h/24h，API 接受任意 ≥60s。run-now 高优先级插队。-disabled 不自动执行。

## G. Playwright 使用范围
仅 chromium（默认 headless）；goto(domcontentloaded)→waitForLoadState('load')→1s settle；css→`.allInnerTexts()` join（支持多元素）、xpath→`xpath=` locator、text→body 行过滤；DEFAULT_TIMEOUT 作整体预算；page.route 阻断 image/media/font（性能考虑，非反爬）。**不做** CAPTCHA/anti-bot 绕过、代理、指纹伪装、stealth。测试/演示全部走本地 fixture，不出网。

## H. 测试策略（Vitest，全离线确定性）
- **unit**：url-guard 私网变体、selector 校验、normalize 同语义同哈希、hash、diff、baseline 语义、unchanged/changed、UNIQUE 重复抑制、间隔计算（注入时钟）、并发上限（20 任务/MAX=5）、同 monitor 防重入、disabled 跳过、webhook 成功/失败/重试上限/4xx 不重试、通知失败不影响 check、SQLite CRUD、service 层、Mock —— 覆盖文档 §26 全部 24 项。
- **integration**（本地 fixture HTTP server + chromium + 临时 SQLite）：①全链路 建→run→baseline→改 fixture→run→changed+事件+Mock 通知→再 run→不重复；②HTTP API validation/404/health/run-now/test-extraction 不落库/错误无 stack。
- CI 里 `playwright install chromium --with-deps`。

## I. Docker / CI
- **Dockerfile 多阶段**：build（node:24-bookworm-slim，npm ci → tsc + vite build）→ runtime（装 chromium 依赖、非 root 用户 `app`、VOLUME /app/data、HEALTHCHECK /health）。compose 单服务（Fastify 托管前端产物）+ named volume `wcm-data` + env_file。
- **CI**：node [22,24] matrix；npm ci → lint(eslint+typescript-eslint) → typecheck → unit → integration → build；npm 缓存；全离线。
- Docker 实测不可用则如实标注"文件已交付、未实际验证构建"。

## 实施顺序
①脚手架+配置+db/migrations ②domain+utils+单测 ③仓储+单测 ④BrowserManager+extraction+fixtures ⑤check 管线+通知+幂等 ⑥scheduler+并发 ⑦Fastify API+集成测试 ⑧React client（Dashboard 统计/列表/详情 diff/添加+Test extraction/删除确认/loading-error-empty 态）⑨Docker+CI+README（§33 全部小节，截图来自真实运行）+`npm run demo`（起 fixture 服务→baseline→翻转→changed→Mock 通知→终端摘要）⑩真实运行验证：install/build/test/lint/demo、/health、创建→baseline→unchanged→改→changed→验事件与通知→查 SQLite；Docker 可用则 compose up 实测 ⑪安全扫描（git check-ignore、secrets/.env/绝对路径/私网 IP 扫描）+ 本地 git commit（不 push）。

## 最终交付（§38）
输出 A–S 完整报告（含测试数量与结果、Demo/Docker/CI/安全扫描实况、5 个 Upwork 技术亮点、4–5 个建议截图位），并明确判断是否达到"可实际运行的小型 Website Change Monitoring 软件"。全部结果来自真实运行，不虚构数据。