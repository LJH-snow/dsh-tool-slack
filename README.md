# dsh-tool-slack

[English](README.md) | [中文](README.zh.md)

A Cordis tool plugin that gives [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) focused Slack workflows: workspace auth checks, channel discovery, channel members, message history, thread replies, message search, user profiles, user groups, file metadata, rich messages, scheduled messages, and common notification actions.

The plugin registers 19 tools with the official `ctx.tools.register(defineTool(...))` contract, uses `presentCall`/`presentResult` for compact replay-friendly UI cards, and treats authentication, request timeout, and cancellation as first-class concerns.

## Install

Install directly from GitHub (no npm publish needed):

```sh
npm install github:LJH-snow/dsh-tool-slack
# or a specific branch/tag
npm install github:LJH-snow/dsh-tool-slack#main
```

Or from a local checkout:

```sh
git clone https://github.com/LJH-snow/dsh-tool-slack
cd dsh-tool-slack
npm install && npm run build   # builds to lib/
npm install /path/to/dsh-tool-slack
```

Requires `@deepseek-ai/cordis` (^4.0.1) and `@deepseek-ai/dsh-tools` (^0.1.0-rc.6) as peer dependencies, provided by the host dsh runtime.

## Configuration

Load the plugin in a dsh composition config (`cordis.yml`):

```yaml
- name: 'dsh-tool-slack'
  config:
    token: 'xoxb-xxx'          # required Slack bot token
    defaultChannel: 'general'  # optional default channel; tools can still override it
    baseUrl: 'https://slack.com/api'   # optional Slack Web API base URL
    timeoutMs: 15000           # optional request timeout in ms (default 15000)
```

Full example: [examples/cordis.yml](examples/cordis.yml).

## Tools

### Read-only

| Tool | Description | Channel |
|---|---|---|
| `slack_auth_test` | Verify a bot token and return workspace/user/bot metadata | n/a |
| `slack_list_channels` | List public/private conversations with pagination | config or arg |
| `slack_get_channel` | Get channel metadata, member count, topic, and purpose | config or arg |
| `slack_list_channel_messages` | List recent channel messages, optionally by time range | config or arg |
| `slack_list_channel_members` | List user ids that are members of a channel | config or arg |
| `slack_list_scheduled_messages` | List scheduled messages with channel/time filters and pagination | config or arg |
| `slack_list_thread_replies` | List replies in a thread by parent message ts | config or arg |
| `slack_search_messages` | Search messages by free text with channel and permalink | n/a |
| `slack_list_users` | List workspace users with profile and role metadata | n/a |
| `slack_list_user_groups` | List workspace user groups with member counts and optional users | n/a |
| `slack_list_user_group_members` | List member user ids for a user group | n/a |
| `slack_list_files` | List file metadata with channel/user/type/time filters and paging | config or arg |
| `slack_get_user` | Get one user profile by Slack user id | n/a |

### Write

| Tool | Description | Channel |
|---|---|---|
| `slack_post_message` | Post a message or thread reply, optionally with Block Kit/attachments | config or arg |
| `slack_update_message` | Update an existing message, optionally with Block Kit/attachments | config or arg |
| `slack_schedule_message` | Schedule a message for later delivery | config or arg |
| `slack_delete_scheduled_message` | Delete a message that has not been sent yet | config or arg |
| `slack_delete_message` | Delete an existing message | config or arg |
| `slack_add_reaction` | Add a reaction emoji to a message | config or arg |

## Behavior contract

- Slack Web API is auth-first, so every tool requires a plugin `token`.
- The plugin always checks Slack's `ok` envelope. Missing resources return `{ found: false }`, and write failures return `{ ok: false, reason }`.
- Infrastructure errors such as HTTP 5xx, timeout, and network failures throw `SlackError` or the original fetch error.
- All requests forward `exec.signal` and use a 15 second timeout by default.
- Output schemas, `render`, `presentCall`, and `presentResult` remain pure, so tool calls and results are replay-safe.

## Development

```sh
npm install
npm run typecheck   # type check
npm test            # unit tests (vitest)
npm run build       # build to lib/
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for technical notes and decisions.

## Publishing

1. Ensure `npm run typecheck`, `npm test`, and `npm run build` all pass.
2. Publish with `npm publish --access public`.
3. Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to the GitHub repository for ecosystem discovery.

## License

[MIT](LICENSE)
