# dsh-tool-slack 开发文档

## 1. 项目概览

| 项目 | 说明 |
|---|---|
| 项目名 | `dsh-tool-slack` |
| 发布名 | `@libai168/dsh-tool-slack` |
| 定位 | DeepSeek Harness（dsh）的独立 Slack Web API 工具插件 |
| 工具数 | 19（13 只读 + 6 写） |
| 架构 | `apply` + `createTools(client)`，通过 `ctx.tools.register(defineTool(...))` 注册 |
| 默认 API | `https://slack.com/api` |

本插件不依赖 GitHub、GitLab 或 monitoring 插件的代码，只复用已验证的插件模式：`SlackClient` 注入 fetch、工具定义与 UI 分离、业务失败返回规范值、基础设施错误抛出。

## 2. 技术要点

### 2.1 客户端

- 认证：`Authorization: Bearer <token>`。
- `baseUrl` 会去掉末尾 `/`，默认 `https://slack.com/api`。
- `timeoutMs` 默认 15000；`exec.signal` 会与超时合并到同一个 `AbortController`。
- 响应始终检查 Slack 的 `ok` 包络；`ok: false` 抛 `SlackError` 并保留 `code`。
- 列表工具统一返回 `items` / `nextCursor` / `hasMore`，翻页参数透传 `response_metadata.next_cursor`。

### 2.2 使用的 Slack Web API

| 方法 | 端点 |
|---|---|
| `authTest` | `GET /api/auth.test` |
| `listChannels` | `GET /api/conversations.list` |
| `getChannel` | `GET /api/conversations.info` |
| `listMessages` | `GET /api/conversations.history` |
| `listReplies` | `GET /api/conversations.replies` |
| `searchMessages` | `GET /api/search.messages` |
| `listUsers` | `GET /api/users.list` |
| `getUser` | `GET /api/users.info` |
| `listChannelMembers` | `GET /api/conversations.members` |
| `listScheduledMessages` | `GET /api/chat.scheduledMessages.list` |
| `listUserGroups` | `GET /api/usergroups.list` |
| `listUserGroupMembers` | `GET /api/usergroups.users.list` |
| `listFiles` | `GET /api/files.list` |
| `postMessage` | `POST /api/chat.postMessage` |
| `updateMessage` | `POST /api/chat.update` |
| `scheduleMessage` | `POST /api/chat.scheduleMessage` |
| `deleteScheduledMessage` | `POST /api/chat.deleteScheduledMessage` |
| `deleteMessage` | `POST /api/chat.delete` |
| `addReaction` | `POST /api/reactions.add` |

### 2.3 UI 约定

- 每个工具都有 `presentCall`/`presentResult` 和纯 `render`。
- 列表工具使用 `search` kind；详情工具使用 `read` kind；写操作用 `edit` kind。
- 输出 schema 中可空字段使用 `oneOf: [string, null]`，避免模型把缺失字段当错误。

## 3. 决策记录

| 时间 | 决策 | 说明 |
|---|---|---|
| 2026-08-30 | 选择 Slack 作为新插件方向 | 与代码托管、数据库、错误监控、项目管理、Kubernetes、监控插件不重叠，覆盖团队沟通与通知闭环 |
| 2026-08-30 | 首批只做 12 个高频工具 | 避免大而全模式，后续可按 Block Kit、文件、日程等方向扩展 |
| 2026-08-30 | v0.2 扩展为 15 个工具 | 新增频道成员、Block Kit/attachments 富文本参数、定时消息发送/删除 |
| 2026-08-30 | v0.3 扩展为 19 个工具 | 新增定时消息列表、用户组列表/成员、文件元信息 |
| 2026-08-30 | 不引入运行时依赖 | HTTP 使用全局 fetch，插件打包面保持最小 |
| 2026-08-30 | 业务失败用规范值 | 资源不存在返回 `{ found: false }`；写失败返回 `{ ok: false, reason }`；基础设施错误抛错 |

## 4. 验证命令

```sh
npm install
npm run typecheck
npm test
npm run build
```

验收时确认：

- `npm run typecheck` 无错误。
- `npm test` 当前 36 例全绿，覆盖客户端 URL/query/body、Slack `ok:false` 错误、分页游标、默认频道、无 token 和工具渲染。
- `npm run build` 输出 `lib/`，`exports.types` 指向生成的声明文件。

## 5. 后续方向

- 文件上传、下载元信息和 `files.remote` 管理。
- 工作区级权限检查。
- `chat.unpostMessage` 和 reaction 删除。

## endpoint 安全校验

`baseUrl` 规范化为 origin + 路径前缀，禁止 credentials、query 和 fragment。每次请求前用 `src/url-security.ts` 做 fail-closed 目标校验：拒绝 localhost/.local 名称、环回、私有、链路本地、CGNAT、组播、保留及全部 IANA 特殊用途地址段，域名 DNS 结果含任一此类地址即拒绝。阻断清单（18 个 IPv4 + 16 个 IPv6）与 IANA 注册表对齐，`src/url-security.ts` 由 `.verify/url-security.template.ts` 生成，不得单独修改。`lookupImpl` 仅作测试注入点，不进入插件配置接口。
