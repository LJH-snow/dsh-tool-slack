# dsh-tool-slack

[English](README.md) | [中文](README.zh.md)

面向 **DeepSeek Harness**（`dsh`）的 Cordis 工具插件，为 Agent 提供聚焦的 Slack 工作流：工作区认证、频道发现、频道成员、消息历史、线程回复、消息搜索、用户资料、富文本消息、定时消息，以及常用通知操作。

插件按官方 `ctx.tools.register(defineTool(...))` 契约注册 15 个工具，使用 `presentCall`/`presentResult` 提供紧凑、可回放的界面卡片，并把认证、超时和取消作为一等行为。

## 安装

直接从 GitHub 安装（无需发布 npm）：

```sh
npm install github:LJH-snow/dsh-tool-slack
# 或指定分支/标签
npm install github:LJH-snow/dsh-tool-slack#main
```

或从本地安装：

```sh
git clone https://github.com/LJH-snow/dsh-tool-slack
cd dsh-tool-slack
npm install && npm run build   # 构建到 lib/
npm install /path/to/dsh-tool-slack
```

需要 `@deepseek-ai/cordis`（^4.0.1）和 `@deepseek-ai/dsh-tools`（^0.1.0-rc.6）作为 peer 依赖，由 dsh 运行时提供。

## 配置

在 dsh 组合配置（`cordis.yml`）中加载插件：

```yaml
- name: 'dsh-tool-slack'
  config:
    token: 'xoxb-xxx'          # 必需的 Slack bot token
    defaultChannel: 'general'  # 可选默认频道，单次调用仍可覆盖
    baseUrl: 'https://slack.com/api'   # 可选 Slack Web API 根地址
    timeoutMs: 15000           # 可选请求超时毫秒数（默认 15000）
```

完整示例见 [examples/cordis.yml](examples/cordis.yml)。

## 工具列表

### 只读

| 工具 | 功能 | 频道来源 |
|---|---|---|
| `slack_auth_test` | 校验 bot token，返回工作区/用户/bot 元信息 | 无 |
| `slack_list_channels` | 列出公开/私密频道，支持分页 | 配置或参数 |
| `slack_get_channel` | 获取频道元信息、成员数、topic 和 purpose | 配置或参数 |
| `slack_list_channel_messages` | 列出频道最近消息，可限定时间范围 | 配置或参数 |
| `slack_list_channel_members` | 列出频道成员对应的 user id | 配置或参数 |
| `slack_list_thread_replies` | 按父消息 ts 列出线程回复 | 配置或参数 |
| `slack_search_messages` | 按自由文本搜索消息，返回频道和 permalink | 无 |
| `slack_list_users` | 列出工作区用户，含资料与角色元信息 | 无 |
| `slack_get_user` | 按 Slack user id 获取单个用户资料 | 无 |

### 写操作

| 工具 | 功能 | 频道来源 |
|---|---|---|
| `slack_post_message` | 发送消息或线程回复，可带 Block Kit/attachments | 配置或参数 |
| `slack_update_message` | 更新已有消息，可带 Block Kit/attachments | 配置或参数 |
| `slack_schedule_message` | 定时发送消息 | 配置或参数 |
| `slack_delete_scheduled_message` | 删除尚未发送的定时消息 | 配置或参数 |
| `slack_delete_message` | 删除已有消息 | 配置或参数 |
| `slack_add_reaction` | 给消息添加 reaction | 配置或参数 |

## 行为约定

- Slack Web API 是 auth-first，因此每个工具都需要插件 `token`。
- 插件始终检查 Slack 的 `ok` 响应包络；资源不存在返回 `{ found: false }`，写操作失败返回 `{ ok: false, reason }`。
- 基础设施错误（HTTP 5xx、超时、网络失败等）抛 `SlackError` 或原始 fetch 错误。
- 所有请求透传 `exec.signal`，默认 15 秒超时。
- 输出 schema、`render`、`presentCall`、`presentResult` 均为纯函数，便于调用与结果回放。

## 开发

```sh
npm install
npm run typecheck   # 类型检查
npm test            # 单元测试（vitest）
npm run build       # 构建到 lib/
```

技术说明与决策见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 发布

1. 确认 `npm run typecheck`、`npm test`、`npm run build` 全部通过。
2. 执行 `npm publish --access public`。
3. 为 GitHub 仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic，便于生态发现。

## License

[MIT](LICENSE)
