import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SlackClient, SlackError } from './client.js'

export const name = 'dsh-tool-slack'
export const inject = ['tools']

export interface SlackPluginConfig {
  /** Slack bot token. Slack Web API calls require it. */
  token?: string
  /** Optional default channel used when tools are called without an explicit channel. */
  defaultChannel?: string
  /** Slack Web API base URL override (default https://slack.com/api). */
  baseUrl?: string
  /** Request timeout in milliseconds. */
  timeoutMs?: number
}

export function apply(ctx: Context, config: SlackPluginConfig = {}) {
  const client = new SlackClient({
    token: config.token,
    defaultChannel: config.defaultChannel,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  })
  for (const tool of createTools(client)) {
    ctx.tools.register(tool)
  }
}

/** Build the tool definitions for a client. Exported so tests can drive execute/render directly. */
export function createTools(client: SlackClient) {
  return [
    defineTool({
      name: 'slack_auth_test',
      description: 'Verify a Slack bot token and return the workspace, user, and bot metadata.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: 'Whether the token is valid' },
            reason: { type: 'string', description: 'Explanation when the token is invalid' },
            teamId: { type: 'string', description: 'Workspace id' },
            teamName: { type: 'string', description: 'Workspace display name' },
            url: { type: 'string', description: 'Workspace URL' },
            userId: { type: 'string', description: 'Authenticated user id' },
            userName: { type: 'string', description: 'Authenticated user name' },
            botId: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Bot id when using a bot token' },
            isEnterpriseInstall: { type: 'boolean', description: 'Whether the install is enterprise-wide' },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return [{ type: 'text', text: `Slack auth failed: ${value.reason}` }]
          return [{ type: 'text', text: `${value.teamName} (${value.teamId})\n${value.url}\n${value.userName} (${value.userId})` }]
        },
      },
      presentCall(): ToolCallView {
        return { card: 'generic', title: 'Verify Slack token', kind: 'read' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; teamName?: string }
        if (!v.ok) return { card: 'generic', title: 'Slack auth failed' }
        return { card: 'generic', title: v.teamName ?? 'Slack workspace' }
      },
      async execute(_args, exec) {
        if (!client.hasToken()) return { ok: false, reason: 'Verifying Slack auth requires a bot token.' }
        try {
          return await client.authTest(exec.signal)
        } catch (error) {
          if (error instanceof SlackError && isAuthFailure(error)) return { ok: false, reason: `Slack rejected the token: ${error.code}` }
          throw error
        }
      },
    }),

    defineTool({
      name: 'slack_list_channels',
      description: 'List Slack conversations visible to the bot, with public/private channel filtering and pagination.',
      parameters: {
        types: {
          type: 'string',
          enum: ['public_channel', 'private_channel', 'public_channel,private_channel', 'mpim', 'im', 'public_channel,private_channel,mpim,im'],
          description: 'Conversation types to include (default public_channel,private_channel)',
        },
        excludeArchived: { type: 'boolean', description: 'Exclude archived channels' },
        limit: { type: 'integer', description: 'Maximum results, 1-200 (default 20)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response nextCursor' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether conversations are accessible' },
            reason: { type: 'string', description: 'Explanation when not accessible' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', description: 'Channel id' },
                  name: { type: 'string', description: 'Channel name' },
                  nameNormalized: { type: 'string', description: 'Normalized channel name' },
                  isChannel: { type: 'boolean', description: 'Whether this is a public channel' },
                  isPrivate: { type: 'boolean', description: 'Whether this is a private channel' },
                  isShared: { type: 'boolean', description: 'Whether the channel is shared' },
                  isArchived: { type: 'boolean', description: 'Whether the channel is archived' },
                  isMember: { type: 'boolean', description: 'Whether the bot is a member' },
                  isGeneral: { type: 'boolean', description: 'Whether this is the general channel' },
                  memberCount: { type: 'integer', description: 'Member count' },
                  created: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Creation timestamp' },
                  topic: { type: 'string', description: 'Channel topic' },
                  purpose: { type: 'string', description: 'Channel purpose' },
                },
              },
            },
            nextCursor: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Cursor for the next page' },
            hasMore: { type: 'boolean', description: 'Whether more conversations are available' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'Conversations are not accessible.' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No conversations found.' }]
          const lines = items.map(item => {
            const kind = item.isPrivate ? 'private' : item.isChannel ? 'public' : 'other'
            const state = item.isArchived ? ' (archived)' : item.isMember ? '' : ' (not joined)'
            return `${item.name} [${kind}${state}] ${item.memberCount ?? 0} members`
          })
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Slack channels (${args.limit ?? 20})`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; items?: Array<{ name: string }> }
        if (!v.found) return { card: 'generic', title: 'Channels not accessible' }
        return { card: 'generic', title: `${(v.items ?? []).length} channel(s)` }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { found: false, items: [], reason: 'Listing Slack channels requires a bot token.' }
        const limit = args.limit === undefined ? 20 : Math.max(1, Math.min(Number(args.limit), 200))
        const result = await client.listChannels({
          types: args.types,
          excludeArchived: args.excludeArchived,
          limit,
          cursor: args.cursor,
          signal: exec.signal,
        })
        return { found: true, ...result }
      },
    }),

    defineTool({
      name: 'slack_get_channel',
      description: 'Get one Slack conversation: type, member count, archive state, topic, and purpose.',
      parameters: {
        channel: { type: 'string', description: 'Channel id or name; defaults to plugin config when omitted' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether the channel was found' },
            reason: { type: 'string', description: 'Explanation when not accessible' },
            id: { type: 'string', description: 'Channel id' },
            name: { type: 'string', description: 'Channel name' },
            nameNormalized: { type: 'string', description: 'Normalized channel name' },
            isChannel: { type: 'boolean', description: 'Whether this is a public channel' },
            isPrivate: { type: 'boolean', description: 'Whether this is a private channel' },
            isShared: { type: 'boolean', description: 'Whether the channel is shared' },
            isArchived: { type: 'boolean', description: 'Whether the channel is archived' },
            isMember: { type: 'boolean', description: 'Whether the bot is a member' },
            isGeneral: { type: 'boolean', description: 'Whether this is the general channel' },
            memberCount: { type: 'integer', description: 'Member count' },
            created: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Creation timestamp' },
            topic: { type: 'string', description: 'Channel topic' },
            purpose: { type: 'string', description: 'Channel purpose' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'Channel not found.' }]
          const lines = [
            `#${value.name} (${value.id})`,
            `${value.isPrivate ? 'private' : value.isChannel ? 'public' : 'conversation'} · ${value.memberCount ?? 0} members`,
            value.isArchived ? 'archived' : '',
            value.topic ? `topic: ${value.topic}` : '',
            value.purpose ? `purpose: ${value.purpose}` : '',
          ].filter(Boolean)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Slack channel ${resolveChannelLabel(client, args)}`, kind: 'read' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; name?: string; id?: string }
        if (!v.found) return { card: 'generic', title: 'Channel not found' }
        return { card: 'generic', title: `#${v.name ?? v.id ?? ''}` }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { found: false, reason: 'Getting Slack channel data requires a bot token.' }
        const channel = resolveChannel(client, args)
        if (!channel) return { found: false, reason: 'Slack channel is required. Set plugin config or pass channel.' }
        try {
          const info = await client.getChannel(channel, exec.signal)
          return { found: true, ...info }
        } catch (error) {
          if (error instanceof SlackError && error.code === 'channel_not_found') return { found: false }
          throw error
        }
      },
    }),

    defineTool({
      name: 'slack_list_channel_messages',
      description: 'List recent messages in a Slack channel, optionally limited to a time range.',
      parameters: {
        channel: { type: 'string', description: 'Channel id or name; defaults to plugin config when omitted' },
        limit: { type: 'integer', description: 'Maximum results, 1-200 (default 20)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response nextCursor' },
        oldest: { type: 'string', description: 'Start of the time range as a Unix timestamp (including fractional seconds)' },
        latest: { type: 'string', description: 'End of the time range as a Unix timestamp (including fractional seconds)' },
        inclusive: { type: 'boolean', description: 'Include messages at the exact oldest/latest boundaries' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether channel history is accessible' },
            reason: { type: 'string', description: 'Explanation when not accessible' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  type: { type: 'string', description: 'Message type' },
                  subtype: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Message subtype' },
                  user: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Message author user id' },
                  botId: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Bot id when authored by a bot' },
                  ts: { type: 'string', description: 'Message timestamp' },
                  threadTs: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Thread timestamp when the message is in a thread' },
                  text: { type: 'string', description: 'Message text' },
                  replyCount: { type: 'integer', description: 'Reply count' },
                  replyUsers: { type: 'array', items: { type: 'string' }, description: 'Users in the thread' },
                  reactions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, count: { type: 'integer' } } }, description: 'Reactions on the message' },
                  editedUser: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'User who last edited the message' },
                  editedTs: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Last edit timestamp' },
                },
              },
            },
            nextCursor: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Cursor for the next page' },
            hasMore: { type: 'boolean', description: 'Whether more messages are available' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'Channel history is not accessible.' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No messages found.' }]
          return [{ type: 'text', text: items.map(item => `${item.ts} <${item.user ?? item.botId ?? 'unknown'}> ${item.text}`).join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Messages in ${resolveChannelLabel(client, args)}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; items?: unknown[] }
        if (!v.found) return { card: 'generic', title: 'Channel history not accessible' }
        return { card: 'generic', title: `${(v.items ?? []).length} message(s)` }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { found: false, items: [], reason: 'Listing Slack channel messages requires a bot token.' }
        const channel = resolveChannel(client, args)
        if (!channel) return { found: false, items: [], reason: 'Slack channel is required. Set plugin config or pass channel.' }
        try {
          const limit = args.limit === undefined ? 20 : Math.max(1, Math.min(Number(args.limit), 200))
          const result = await client.listMessages(channel, {
            limit,
            cursor: args.cursor,
            oldest: args.oldest,
            latest: args.latest,
            inclusive: args.inclusive,
            signal: exec.signal,
          })
          return { found: true, ...result }
        } catch (error) {
          if (error instanceof SlackError && error.code === 'channel_not_found') return { found: false, items: [], reason: 'Channel not found.' }
          throw error
        }
      },
    }),

    defineTool({
      name: 'slack_list_thread_replies',
      description: 'List the replies in a Slack thread, using the parent message ts.',
      parameters: {
        channel: { type: 'string', description: 'Channel id or name; defaults to plugin config when omitted' },
        threadTs: { type: 'string', required: true, description: 'Parent message timestamp, e.g. 1234567890.123456' },
        limit: { type: 'integer', description: 'Maximum results, 1-200 (default 20)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response nextCursor' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether thread replies are accessible' },
            reason: { type: 'string', description: 'Explanation when not accessible' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  type: { type: 'string', description: 'Message type' },
                  subtype: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Message subtype' },
                  user: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Reply author user id' },
                  botId: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Bot id when authored by a bot' },
                  ts: { type: 'string', description: 'Reply timestamp' },
                  threadTs: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Parent thread timestamp' },
                  text: { type: 'string', description: 'Reply text' },
                  replyCount: { type: 'integer', description: 'Reply count' },
                  replyUsers: { type: 'array', items: { type: 'string' }, description: 'Users in the thread' },
                  reactions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, count: { type: 'integer' } } }, description: 'Reactions on the reply' },
                },
              },
            },
            nextCursor: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Cursor for the next page' },
            hasMore: { type: 'boolean', description: 'Whether more replies are available' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'Thread replies are not accessible.' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No replies found.' }]
          return [{ type: 'text', text: items.map(item => `${item.ts} <${item.user ?? item.botId ?? 'unknown'}> ${item.text}`).join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Thread ${args.threadTs} in ${resolveChannelLabel(client, args)}`, kind: 'read' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; items?: unknown[] }
        if (!v.found) return { card: 'generic', title: 'Thread replies not accessible' }
        return { card: 'generic', title: `${(v.items ?? []).length} reply/replies` }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { found: false, items: [], reason: 'Listing Slack thread replies requires a bot token.' }
        const channel = resolveChannel(client, args)
        if (!channel) return { found: false, items: [], reason: 'Slack channel is required. Set plugin config or pass channel.' }
        try {
          const limit = args.limit === undefined ? 20 : Math.max(1, Math.min(Number(args.limit), 200))
          const result = await client.listReplies(channel, args.threadTs as string, {
            limit,
            cursor: args.cursor,
            signal: exec.signal,
          })
          return { found: true, ...result }
        } catch (error) {
          if (error instanceof SlackError && (error.code === 'channel_not_found' || error.code === 'thread_not_found')) {
            return { found: false, items: [], reason: 'Thread or channel not found.' }
          }
          throw error
        }
      },
    }),

    defineTool({
      name: 'slack_search_messages',
      description: 'Search Slack messages by free text, returning recent matches with channel and permalink.',
      parameters: {
        query: { type: 'string', required: true, description: 'Slack search query, e.g. deployment failed in:general' },
        limit: { type: 'integer', description: 'Maximum results, 1-100 (default 10)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether search is accessible' },
            reason: { type: 'string', description: 'Explanation when not accessible' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  type: { type: 'string', description: 'Message type' },
                  channelId: { type: 'string', description: 'Channel id' },
                  channelName: { type: 'string', description: 'Channel name' },
                  user: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Author user id' },
                  username: { type: 'string', description: 'Author display name' },
                  text: { type: 'string', description: 'Matching message text' },
                  permalink: { type: 'string', description: 'Message permalink' },
                  ts: { type: 'string', description: 'Message timestamp' },
                  teamId: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Team id' },
                  botId: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Bot id when authored by a bot' },
                },
              },
            },
            nextCursor: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Cursor for the next page' },
            hasMore: { type: 'boolean', description: 'Whether more matches are available' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'Slack search is not accessible.' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No matching messages found.' }]
          const lines = items.map(item => `${item.channelName} ${item.ts} <${item.username}> ${item.text}\n${item.permalink}`)
          return [{ type: 'text', text: lines.join('\n---\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Search Slack for ${args.query}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; items?: unknown[] }
        if (!v.found) return { card: 'generic', title: 'Slack search not accessible' }
        return { card: 'generic', title: `${(v.items ?? []).length} message(s)` }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { found: false, items: [], reason: 'Searching Slack messages requires a bot token with search scope.' }
        const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(Number(args.limit), 100))
        const result = await client.searchMessages(args.query as string, { limit, signal: exec.signal })
        return { found: true, ...result }
      },
    }),

    defineTool({
      name: 'slack_list_users',
      description: 'List Slack workspace users visible to the bot, with status, role, and profile metadata.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum results, 1-200 (default 20)' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous response nextCursor' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether users are accessible' },
            reason: { type: 'string', description: 'Explanation when not accessible' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', description: 'User id' },
                  teamId: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Team id' },
                  name: { type: 'string', description: 'Slack username' },
                  displayName: { type: 'string', description: 'Profile display name' },
                  realName: { type: 'string', description: 'Profile real name' },
                  email: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Profile email' },
                  title: { type: 'string', description: 'Profile title' },
                  tz: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Timezone' },
                  tzLabel: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Timezone label' },
                  isBot: { type: 'boolean', description: 'Whether this is a bot user' },
                  deleted: { type: 'boolean', description: 'Whether the user is deleted' },
                  isAdmin: { type: 'boolean', description: 'Whether the user is an admin' },
                  isOwner: { type: 'boolean', description: 'Whether the user is an owner' },
                  isRestricted: { type: 'boolean', description: 'Whether the user is restricted' },
                  isUltraRestricted: { type: 'boolean', description: 'Whether the user is ultra restricted' },
                  imageUrl: { type: 'string', description: 'Profile image URL' },
                  statusText: { type: 'string', description: 'Current status text' },
                  statusEmoji: { type: 'string', description: 'Current status emoji' },
                },
              },
            },
            nextCursor: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Cursor for the next page' },
            hasMore: { type: 'boolean', description: 'Whether more users are available' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'Users are not accessible.' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No users found.' }]
          const lines = items.map(item => `${item.displayName || item.name} (@${item.name}) ${item.email ?? ''}${item.isBot ? ' [bot]' : ''}`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Slack users (${args.limit ?? 20})`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; items?: unknown[] }
        if (!v.found) return { card: 'generic', title: 'Users not accessible' }
        return { card: 'generic', title: `${(v.items ?? []).length} user(s)` }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { found: false, items: [], reason: 'Listing Slack users requires a bot token.' }
        const limit = args.limit === undefined ? 20 : Math.max(1, Math.min(Number(args.limit), 200))
        const result = await client.listUsers({ limit, cursor: args.cursor, signal: exec.signal })
        return { found: true, ...result }
      },
    }),

    defineTool({
      name: 'slack_get_user',
      description: 'Get one Slack user profile: name, email, title, timezone, roles, and current status.',
      parameters: {
        user: { type: 'string', required: true, description: 'Slack user id, e.g. U12345678' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether the user was found' },
            reason: { type: 'string', description: 'Explanation when not accessible' },
            id: { type: 'string', description: 'User id' },
            teamId: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Team id' },
            name: { type: 'string', description: 'Slack username' },
            displayName: { type: 'string', description: 'Profile display name' },
            realName: { type: 'string', description: 'Profile real name' },
            email: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Profile email' },
            title: { type: 'string', description: 'Profile title' },
            tz: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Timezone' },
            tzLabel: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Timezone label' },
            isBot: { type: 'boolean', description: 'Whether this is a bot user' },
            deleted: { type: 'boolean', description: 'Whether the user is deleted' },
            isAdmin: { type: 'boolean', description: 'Whether the user is an admin' },
            isOwner: { type: 'boolean', description: 'Whether the user is an owner' },
            isRestricted: { type: 'boolean', description: 'Whether the user is restricted' },
            isUltraRestricted: { type: 'boolean', description: 'Whether the user is ultra restricted' },
            imageUrl: { type: 'string', description: 'Profile image URL' },
            statusText: { type: 'string', description: 'Current status text' },
            statusEmoji: { type: 'string', description: 'Current status emoji' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'User not found.' }]
          const lines = [
            `${value.displayName || value.realName || value.name} (@${value.name})`,
            value.email ?? '',
            value.title ?? '',
            `roles: ${[value.isAdmin ? 'admin' : null, value.isOwner ? 'owner' : null, value.isRestricted ? 'restricted' : null, value.isUltraRestricted ? 'ultra restricted' : null, value.isBot ? 'bot' : null].filter(Boolean).join(', ') || 'member'}`,
            value.tzLabel ? `timezone: ${value.tzLabel}` : '',
            value.statusText ? `status: ${value.statusEmoji} ${value.statusText}` : '',
          ].filter(Boolean)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Slack user ${args.user}`, kind: 'read' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; displayName?: string; name?: string }
        if (!v.found) return { card: 'generic', title: 'User not found' }
        return { card: 'generic', title: v.displayName || v.name || 'Slack user' }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { found: false, reason: 'Getting Slack user data requires a bot token.' }
        try {
          const info = await client.getUser(args.user as string, exec.signal)
          return { found: true, ...info }
        } catch (error) {
          if (error instanceof SlackError && error.code === 'user_not_found') return { found: false }
          throw error
        }
      },
    }),

    defineTool({
      name: 'slack_post_message',
      description: 'Post a message to a Slack channel or thread. WRITE operation: requires channel write access.',
      parameters: {
        channel: { type: 'string', description: 'Channel id or name; defaults to plugin config when omitted' },
        text: { type: 'string', required: true, description: 'Message text' },
        threadTs: { type: 'string', description: 'Parent message ts to reply in an existing thread' },
        replyBroadcast: { type: 'boolean', description: 'Also broadcast a thread reply to the channel' },
        mrkdwn: { type: 'boolean', description: 'Enable Slack markdown in the message' },
        linkNames: { type: 'boolean', description: 'Linkify channel and usernames' },
        unfurlLinks: { type: 'boolean', description: 'Unfurl links' },
        unfurlMedia: { type: 'boolean', description: 'Unfurl media' },
        asUser: { type: 'boolean', description: 'Post as the authenticated user instead of the bot' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: 'Whether the message was posted' },
            channel: { type: 'string', description: 'Channel id that received the message' },
            ts: { type: 'string', description: 'New message timestamp' },
            text: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Posted message text' },
            user: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Posting user id' },
            reason: { type: 'string', description: 'Explanation when not posted' },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return [{ type: 'text', text: `Could not post Slack message: ${value.reason}` }]
          return [{ type: 'text', text: `Posted to ${value.channel} at ${value.ts}\n${value.text ?? ''}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Post to ${resolveChannelLabel(client, args)}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; channel?: string; ts?: string }
        if (!v.ok) return { card: 'generic', title: 'Post failed' }
        return { card: 'generic', title: `Posted to ${v.channel ?? ''}`, content: [{ type: 'text', text: v.ts ?? '' }] }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { ok: false, channel: '', ts: '', text: null, user: null, reason: 'Posting a Slack message requires a bot token.' }
        const channel = resolveChannel(client, args)
        if (!channel) return { ok: false, channel: '', ts: '', text: null, user: null, reason: 'Slack channel is required. Set plugin config or pass channel.' }
        try {
          return await client.postMessage({
            channel,
            text: args.text as string,
            threadTs: args.threadTs,
            replyBroadcast: args.replyBroadcast,
            mrkdwn: args.mrkdwn,
            linkNames: args.linkNames,
            unfurlLinks: args.unfurlLinks,
            unfurlMedia: args.unfurlMedia,
            asUser: args.asUser,
            signal: exec.signal,
          })
        } catch (error) {
          if (error instanceof SlackError && isWriteFailure(error)) {
            return { ok: false, channel, ts: '', text: null, user: null, reason: `Slack rejected the message: ${error.code}` }
          }
          throw error
        }
      },
    }),

    defineTool({
      name: 'slack_update_message',
      description: 'Update an existing Slack message. WRITE operation: requires channel write access.',
      parameters: {
        channel: { type: 'string', description: 'Channel id or name; defaults to plugin config when omitted' },
        ts: { type: 'string', required: true, description: 'Message timestamp, e.g. 1234567890.123456' },
        text: { type: 'string', description: 'Replacement message text' },
        mrkdwn: { type: 'boolean', description: 'Enable Slack markdown in the message' },
        linkNames: { type: 'boolean', description: 'Linkify channel and usernames' },
        parse: { type: 'string', enum: ['none', 'full'], description: 'How to parse the message text' },
        asUser: { type: 'boolean', description: 'Update as the authenticated user instead of the bot' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: 'Whether the message was updated' },
            channel: { type: 'string', description: 'Channel id that contains the message' },
            ts: { type: 'string', description: 'Message timestamp' },
            text: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Updated message text' },
            user: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Message author id' },
            reason: { type: 'string', description: 'Explanation when not updated' },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return [{ type: 'text', text: `Could not update Slack message: ${value.reason}` }]
          return [{ type: 'text', text: `Updated ${value.channel} at ${value.ts}\n${value.text ?? ''}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Update message ${args.ts}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; ts?: string }
        if (!v.ok) return { card: 'generic', title: 'Update failed' }
        return { card: 'generic', title: `Message ${v.ts ?? ''} updated` }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { ok: false, channel: '', ts: args.ts as string, text: null, user: null, reason: 'Updating a Slack message requires a bot token.' }
        const channel = resolveChannel(client, args)
        if (!channel) return { ok: false, channel: '', ts: args.ts as string, text: null, user: null, reason: 'Slack channel is required. Set plugin config or pass channel.' }
        try {
          return await client.updateMessage({
            channel,
            ts: args.ts as string,
            text: args.text,
            mrkdwn: args.mrkdwn,
            linkNames: args.linkNames,
            parse: args.parse,
            asUser: args.asUser,
            signal: exec.signal,
          })
        } catch (error) {
          if (error instanceof SlackError && isWriteFailure(error)) {
            return { ok: false, channel, ts: args.ts as string, text: null, user: null, reason: `Slack rejected the update: ${error.code}` }
          }
          throw error
        }
      },
    }),

    defineTool({
      name: 'slack_delete_message',
      description: 'Delete an existing Slack message. WRITE operation: requires channel write access.',
      parameters: {
        channel: { type: 'string', description: 'Channel id or name; defaults to plugin config when omitted' },
        ts: { type: 'string', required: true, description: 'Message timestamp, e.g. 1234567890.123456' },
        asUser: { type: 'boolean', description: 'Delete as the authenticated user instead of the bot' },
        force: { type: 'boolean', description: 'Force deletion of the oldest message in a channel' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: 'Whether the message was deleted' },
            channel: { type: 'string', description: 'Channel id that contained the message' },
            ts: { type: 'string', description: 'Deleted message timestamp' },
            reason: { type: 'string', description: 'Explanation when not deleted' },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return [{ type: 'text', text: `Could not delete Slack message: ${value.reason}` }]
          return [{ type: 'text', text: `Deleted ${value.channel} at ${value.ts}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Delete message ${args.ts}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; ts?: string }
        if (!v.ok) return { card: 'generic', title: 'Delete failed' }
        return { card: 'generic', title: `Message ${v.ts ?? ''} deleted` }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { ok: false, channel: '', ts: args.ts as string, reason: 'Deleting a Slack message requires a bot token.' }
        const channel = resolveChannel(client, args)
        if (!channel) return { ok: false, channel: '', ts: args.ts as string, reason: 'Slack channel is required. Set plugin config or pass channel.' }
        try {
          return await client.deleteMessage({
            channel,
            ts: args.ts as string,
            asUser: args.asUser,
            force: args.force,
            signal: exec.signal,
          })
        } catch (error) {
          if (error instanceof SlackError && isWriteFailure(error)) {
            return { ok: false, channel, ts: args.ts as string, reason: `Slack rejected the delete: ${error.code}` }
          }
          throw error
        }
      },
    }),

    defineTool({
      name: 'slack_add_reaction',
      description: 'Add a reaction emoji to a Slack message. WRITE operation: requires channel access.',
      parameters: {
        channel: { type: 'string', description: 'Channel id or name; defaults to plugin config when omitted' },
        timestamp: { type: 'string', required: true, description: 'Message timestamp, e.g. 1234567890.123456' },
        name: { type: 'string', required: true, description: 'Reaction name without colons, e.g. +1, rocket, white_check_mark' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: 'Whether the reaction was added' },
            channel: { type: 'string', description: 'Channel id' },
            ts: { type: 'string', description: 'Message timestamp' },
            reason: { type: 'string', description: 'Explanation when not added' },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return [{ type: 'text', text: `Could not add Slack reaction: ${value.reason}` }]
          return [{ type: 'text', text: `Reaction added to ${value.channel} at ${value.ts}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Add :${args.name}: to ${args.timestamp}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; ts?: string }
        if (!v.ok) return { card: 'generic', title: 'Reaction failed' }
        return { card: 'generic', title: `Reaction added to ${v.ts ?? ''}` }
      },
      async execute(args, exec) {
        if (!client.hasToken()) return { ok: false, channel: '', ts: args.timestamp as string, reason: 'Adding a Slack reaction requires a bot token.' }
        const channel = resolveChannel(client, args)
        if (!channel) return { ok: false, channel: '', ts: args.timestamp as string, reason: 'Slack channel is required. Set plugin config or pass channel.' }
        try {
          return await client.addReaction({ channel, timestamp: args.timestamp as string, name: args.name as string, signal: exec.signal })
        } catch (error) {
          if (error instanceof SlackError && isWriteFailure(error)) {
            return { ok: false, channel, ts: args.timestamp as string, reason: `Slack rejected the reaction: ${error.code}` }
          }
          throw error
        }
      },
    }),
  ]
}

function resolveChannel(client: SlackClient, args: Record<string, unknown>): string | null {
  const explicit = typeof args.channel === 'string' ? args.channel : undefined
  return explicit ?? client.getDefaultChannel() ?? null
}

function resolveChannelLabel(client: SlackClient, args: Record<string, unknown>): string {
  return resolveChannel(client, args) ?? 'unknown channel'
}

function isAuthFailure(error: SlackError): boolean {
  return error.code === 'invalid_auth' || error.code === 'not_authed' || error.code === 'token_expired' || error.code === 'token_revoked' || error.code === 'account_inactive'
}

function isWriteFailure(error: SlackError): boolean {
  return Boolean(error.code) && error.status < 500 && !isAuthFailure(error)
}
