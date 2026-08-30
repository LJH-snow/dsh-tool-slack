/** Slack Web API client with injected fetch for testability. */

export interface SlackClientOptions {
  token?: string
  /** Optional default channel used when tools are called without an explicit channel. */
  defaultChannel?: string
  /** Slack Web API base URL override (default https://slack.com/api). */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Request timeout in milliseconds. 0 disables the timeout. */
  timeoutMs?: number
}

export interface AuthInfo {
  ok: true
  teamId: string
  teamName: string
  url: string
  userId: string
  userName: string
  botId: string | null
  isEnterpriseInstall: boolean
}

export interface ChannelInfo {
  id: string
  name: string
  nameNormalized: string
  isChannel: boolean
  isPrivate: boolean
  isShared: boolean
  isArchived: boolean
  isMember: boolean
  isGeneral: boolean
  memberCount: number
  created: string | null
  topic: string
  purpose: string
}

export interface UserInfo {
  id: string
  teamId: string | null
  name: string
  displayName: string
  realName: string
  email: string | null
  title: string
  tz: string | null
  tzLabel: string | null
  isBot: boolean
  deleted: boolean
  isAdmin: boolean
  isOwner: boolean
  isRestricted: boolean
  isUltraRestricted: boolean
  imageUrl: string
  statusText: string
  statusEmoji: string
}

export interface MessageInfo {
  type: string
  subtype: string | null
  user: string | null
  botId: string | null
  ts: string
  threadTs: string | null
  channel: string | null
  text: string
  replyCount: number
  replyUsers: string[]
  reactions: Array<{ name: string; count: number }>
  editedUser: string | null
  editedTs: string | null
}

export interface SearchMessageInfo {
  type: string
  channelId: string
  channelName: string
  user: string | null
  username: string
  text: string
  permalink: string
  ts: string
  teamId: string | null
  botId: string | null
}

export interface SlackListResult<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export interface MessageWriteResult {
  ok: boolean
  channel: string
  ts: string
  text: string | null
  user: string | null
  reason?: string
}

export interface ScheduledMessageResult {
  ok: boolean
  channel: string
  scheduledMessageId: string
  postAt: string | null
  text: string | null
  user: string | null
  reason?: string
}

export interface MessageDeleteResult {
  ok: boolean
  channel: string
  ts: string
  reason?: string
}

export interface ScheduledMessageDeleteResult {
  ok: boolean
  channel: string
  scheduledMessageId: string
  reason?: string
}

export interface ReactionResult {
  ok: boolean
  channel: string
  ts: string
  reason?: string
}

export type SlackBlock = Record<string, unknown>
export type SlackAttachment = Record<string, unknown>

export class SlackError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message)
    this.name = 'SlackError'
  }
}

interface RawAuth {
  ok: boolean
  team_id?: string
  team?: string
  url?: string
  user_id?: string
  user?: string
  bot_id?: string | null
  is_enterprise_install?: boolean
  error?: string
}

interface RawChannel {
  id: string
  name?: string
  name_normalized?: string
  is_channel?: boolean
  is_private?: boolean
  is_shared?: boolean
  is_archived?: boolean
  is_member?: boolean
  is_general?: boolean
  num_members?: number
  created?: number
  topic?: { value?: string }
  purpose?: { value?: string }
}

interface RawUser {
  id: string
  team_id?: string
  name?: string
  deleted?: boolean
  real_name?: string
  tz?: string | null
  tz_label?: string | null
  is_bot?: boolean
  is_admin?: boolean
  is_owner?: boolean
  is_restricted?: boolean
  is_ultra_restricted?: boolean
  profile?: {
    display_name?: string
    real_name?: string
    email?: string | null
    title?: string
    image_72?: string
    status_text?: string
    status_emoji?: string
  }
}

interface RawMessage {
  type?: string
  subtype?: string | null
  user?: string | null
  bot_id?: string | null
  ts: string
  thread_ts?: string | null
  channel?: string | null
  text?: string
  reply_count?: number
  reply_users?: string[]
  reactions?: Array<{ name?: string; count?: number }>
  edited?: { user?: string | null; ts?: string | null }
}

interface RawSearchMatch {
  type?: string
  channel?: { id?: string; name?: string }
  user?: string | null
  username?: string
  text?: string
  permalink?: string
  ts?: string
  team?: string
  bot_id?: string | null
}

interface RawSearch {
  ok?: boolean
  messages?: {
    total?: number
    matches?: RawSearchMatch[]
    paging?: { count?: number; total?: number; page?: number; pages?: number }
  }
  error?: string
}

interface RawList {
  ok?: boolean
  channels?: RawChannel[]
  members?: RawUser[]
  messages?: RawMessage[]
  response_metadata?: { next_cursor?: string }
  has_more?: boolean
  error?: string
}

interface RawMembersList {
  ok?: boolean
  members?: string[]
  response_metadata?: { next_cursor?: string }
  has_more?: boolean
  error?: string
}

interface RawChannelInfo {
  ok?: boolean
  channel?: RawChannel
  error?: string
}

interface RawUserInfo {
  ok?: boolean
  user?: RawUser
  error?: string
}

interface RawMessageWrite {
  ok?: boolean
  channel?: string
  ts?: string
  text?: string
  user?: string | null
  message?: RawMessage
  error?: string
}

interface RawDelete {
  ok?: boolean
  channel?: string
  ts?: string
  error?: string
}

interface RawScheduledMessage {
  ok?: boolean
  channel?: string
  scheduled_message_id?: string
  post_at?: string | number | null
  text?: string
  user?: string | null
  error?: string
}

interface RawDeleteScheduledMessage {
  ok?: boolean
  channel?: string
  scheduled_message_id?: string
  error?: string
}

interface RawReaction {
  ok?: boolean
  error?: string
}

function codeOf(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'error' in value) {
    const code = (value as { error?: unknown }).error
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function messageOf(value: unknown, fallback: string): string {
  return codeOf(value) ?? fallback
}

function mapAuth(raw: RawAuth): AuthInfo {
  return {
    ok: true,
    teamId: raw.team_id ?? '',
    teamName: raw.team ?? '',
    url: raw.url ?? '',
    userId: raw.user_id ?? '',
    userName: raw.user ?? '',
    botId: raw.bot_id ?? null,
    isEnterpriseInstall: raw.is_enterprise_install ?? false,
  }
}

function mapChannel(raw: RawChannel): ChannelInfo {
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    nameNormalized: raw.name_normalized ?? raw.name ?? raw.id,
    isChannel: raw.is_channel ?? false,
    isPrivate: raw.is_private ?? false,
    isShared: raw.is_shared ?? false,
    isArchived: raw.is_archived ?? false,
    isMember: raw.is_member ?? false,
    isGeneral: raw.is_general ?? false,
    memberCount: raw.num_members ?? 0,
    created: typeof raw.created === 'number' && Number.isFinite(raw.created) ? new Date(raw.created * 1000).toISOString() : null,
    topic: raw.topic?.value ?? '',
    purpose: raw.purpose?.value ?? '',
  }
}

function mapUser(raw: RawUser): UserInfo {
  return {
    id: raw.id,
    teamId: raw.team_id ?? null,
    name: raw.name ?? raw.id,
    displayName: raw.profile?.display_name ?? raw.profile?.real_name ?? raw.name ?? raw.id,
    realName: raw.profile?.real_name ?? raw.real_name ?? '',
    email: raw.profile?.email ?? null,
    title: raw.profile?.title ?? '',
    tz: raw.tz ?? null,
    tzLabel: raw.tz_label ?? null,
    isBot: raw.is_bot ?? false,
    deleted: raw.deleted ?? false,
    isAdmin: raw.is_admin ?? false,
    isOwner: raw.is_owner ?? false,
    isRestricted: raw.is_restricted ?? false,
    isUltraRestricted: raw.is_ultra_restricted ?? false,
    imageUrl: raw.profile?.image_72 ?? '',
    statusText: raw.profile?.status_text ?? '',
    statusEmoji: raw.profile?.status_emoji ?? '',
  }
}

function mapMessage(raw: RawMessage): MessageInfo {
  return {
    type: raw.type ?? 'message',
    subtype: raw.subtype ?? null,
    user: raw.user ?? null,
    botId: raw.bot_id ?? null,
    ts: raw.ts,
    threadTs: raw.thread_ts ?? null,
    channel: raw.channel ?? null,
    text: raw.text ?? '',
    replyCount: raw.reply_count ?? 0,
    replyUsers: raw.reply_users ?? [],
    reactions: (raw.reactions ?? []).map(item => ({ name: item.name ?? '', count: item.count ?? 0 })),
    editedUser: raw.edited?.user ?? null,
    editedTs: raw.edited?.ts ?? null,
  }
}

function mapSearchMessage(raw: RawSearchMatch): SearchMessageInfo {
  return {
    type: raw.type ?? 'message',
    channelId: raw.channel?.id ?? '',
    channelName: raw.channel?.name ?? raw.channel?.id ?? '',
    user: raw.user ?? null,
    username: raw.username ?? raw.user ?? '',
    text: raw.text ?? '',
    permalink: raw.permalink ?? '',
    ts: raw.ts ?? '',
    teamId: raw.team ?? null,
    botId: raw.bot_id ?? null,
  }
}

function listResult<T>(items: T[], raw: RawList): SlackListResult<T> {
  const nextCursor = raw.response_metadata?.next_cursor ? raw.response_metadata.next_cursor : null
  return { items, nextCursor, hasMore: Boolean(nextCursor) || raw.has_more === true }
}

export class SlackClient {
  private readonly token: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: SlackClientOptions = {}) {
    this.token = options.token ?? ''
    this.baseUrl = (options.baseUrl ?? 'https://slack.com/api').replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 15000
  }

  hasToken(): boolean {
    return this.token.length > 0
  }

  getDefaultChannel(): string | undefined {
    return this.options.defaultChannel
  }

  async authTest(signal?: AbortSignal): Promise<AuthInfo> {
    const raw = await this.request<RawAuth>('auth.test', { signal })
    return mapAuth(raw)
  }

  async listChannels(options: {
    types?: string
    excludeArchived?: boolean
    limit?: number
    cursor?: string
    signal?: AbortSignal
  } = {}): Promise<SlackListResult<ChannelInfo>> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(options.limit ?? 20, 200))),
      types: options.types ?? 'public_channel,private_channel',
    })
    if (options.excludeArchived !== undefined) params.set('exclude_archived', options.excludeArchived ? 'true' : 'false')
    if (options.cursor) params.set('cursor', options.cursor)
    const raw = await this.request<RawList>('conversations.list', { params, signal: options.signal })
    return listResult((raw.channels ?? []).map(mapChannel), raw)
  }

  async getChannel(channel: string, signal?: AbortSignal): Promise<ChannelInfo> {
    const params = new URLSearchParams({ channel })
    const raw = await this.request<RawChannelInfo>('conversations.info', { params, signal })
    return mapChannel(raw.channel ?? { id: channel })
  }

  async listMessages(
    channel: string,
    options: {
      limit?: number
      cursor?: string
      oldest?: string
      latest?: string
      inclusive?: boolean
      signal?: AbortSignal
    } = {},
  ): Promise<SlackListResult<MessageInfo>> {
    const params = new URLSearchParams({
      channel,
      limit: String(Math.max(1, Math.min(options.limit ?? 20, 200))),
    })
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.oldest) params.set('oldest', options.oldest)
    if (options.latest) params.set('latest', options.latest)
    if (options.inclusive !== undefined) params.set('inclusive', options.inclusive ? 'true' : 'false')
    const raw = await this.request<RawList>('conversations.history', { params, signal: options.signal })
    return listResult((raw.messages ?? []).map(mapMessage), raw)
  }

  async listReplies(
    channel: string,
    threadTs: string,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<SlackListResult<MessageInfo>> {
    const params = new URLSearchParams({
      channel,
      ts: threadTs,
      limit: String(Math.max(1, Math.min(options.limit ?? 20, 200))),
    })
    if (options.cursor) params.set('cursor', options.cursor)
    const raw = await this.request<RawList>('conversations.replies', { params, signal: options.signal })
    return listResult((raw.messages ?? []).map(mapMessage), raw)
  }

  async listUsers(options: { limit?: number; cursor?: string; signal?: AbortSignal } = {}): Promise<SlackListResult<UserInfo>> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(options.limit ?? 20, 200))),
    })
    if (options.cursor) params.set('cursor', options.cursor)
    const raw = await this.request<RawList>('users.list', { params, signal: options.signal })
    return listResult((raw.members ?? []).map(mapUser), raw)
  }

  async getUser(user: string, signal?: AbortSignal): Promise<UserInfo> {
    const params = new URLSearchParams({ user })
    const raw = await this.request<RawUserInfo>('users.info', { params, signal })
    return mapUser(raw.user ?? { id: user })
  }

  async listChannelMembers(
    channel: string,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<SlackListResult<string>> {
    const params = new URLSearchParams({
      channel,
      limit: String(Math.max(1, Math.min(options.limit ?? 20, 200))),
    })
    if (options.cursor) params.set('cursor', options.cursor)
    const raw = await this.request<RawMembersList>('conversations.members', { params, signal: options.signal })
    const nextCursor = raw.response_metadata?.next_cursor ? raw.response_metadata.next_cursor : null
    return { items: raw.members ?? [], nextCursor, hasMore: Boolean(nextCursor) || raw.has_more === true }
  }

  async searchMessages(
    query: string,
    options: { limit?: number; cursor?: never; signal?: AbortSignal } = {},
  ): Promise<SlackListResult<SearchMessageInfo>> {
    const params = new URLSearchParams({
      query,
      count: String(Math.max(1, Math.min(options.limit ?? 10, 100))),
      sort: 'timestamp',
      sort_dir: 'desc',
    })
    const raw = await this.request<RawSearch>('search.messages', { params, signal: options.signal })
    return { items: (raw.messages?.matches ?? []).map(mapSearchMessage), nextCursor: null, hasMore: false }
  }

  async postMessage(input: {
    channel: string
    text?: string
    blocks?: SlackBlock[]
    attachments?: SlackAttachment[]
    threadTs?: string
    replyBroadcast?: boolean
    mrkdwn?: boolean
    linkNames?: boolean
    unfurlLinks?: boolean
    unfurlMedia?: boolean
    parse?: string
    username?: string
    iconEmoji?: string
    iconUrl?: string
    asUser?: boolean
    signal?: AbortSignal
  }): Promise<MessageWriteResult> {
    const body: Record<string, unknown> = { channel: input.channel }
    this.addOptional(body, 'text', input.text)
    this.addOptional(body, 'blocks', input.blocks)
    this.addOptional(body, 'attachments', input.attachments)
    this.addOptional(body, 'thread_ts', input.threadTs)
    this.addOptional(body, 'reply_broadcast', input.replyBroadcast)
    this.addOptional(body, 'mrkdwn', input.mrkdwn)
    this.addOptional(body, 'link_names', input.linkNames)
    this.addOptional(body, 'unfurl_links', input.unfurlLinks)
    this.addOptional(body, 'unfurl_media', input.unfurlMedia)
    this.addOptional(body, 'parse', input.parse)
    this.addOptional(body, 'username', input.username)
    this.addOptional(body, 'icon_emoji', input.iconEmoji)
    this.addOptional(body, 'icon_url', input.iconUrl)
    this.addOptional(body, 'as_user', input.asUser)
    const raw = await this.request<RawMessageWrite>('chat.postMessage', {
      init: { method: 'POST', body: JSON.stringify(body) },
      signal: input.signal,
    })
    return {
      ok: true,
      channel: raw.channel ?? input.channel,
      ts: raw.ts ?? '',
      text: raw.message?.text ?? raw.text ?? null,
      user: raw.message?.user ?? null,
    }
  }

  async updateMessage(input: {
    channel: string
    ts: string
    text?: string
    blocks?: SlackBlock[]
    attachments?: SlackAttachment[]
    mrkdwn?: boolean
    linkNames?: boolean
    parse?: string
    asUser?: boolean
    signal?: AbortSignal
  }): Promise<MessageWriteResult> {
    const body: Record<string, unknown> = { channel: input.channel, ts: input.ts }
    this.addOptional(body, 'text', input.text)
    this.addOptional(body, 'blocks', input.blocks)
    this.addOptional(body, 'attachments', input.attachments)
    this.addOptional(body, 'mrkdwn', input.mrkdwn)
    this.addOptional(body, 'link_names', input.linkNames)
    this.addOptional(body, 'parse', input.parse)
    this.addOptional(body, 'as_user', input.asUser)
    const raw = await this.request<RawMessageWrite>('chat.update', {
      init: { method: 'POST', body: JSON.stringify(body) },
      signal: input.signal,
    })
    return {
      ok: true,
      channel: raw.channel ?? input.channel,
      ts: raw.ts ?? input.ts,
      text: raw.message?.text ?? raw.text ?? null,
      user: raw.message?.user ?? null,
    }
  }

  async scheduleMessage(input: {
    channel: string
    text?: string
    blocks?: SlackBlock[]
    attachments?: SlackAttachment[]
    postAt: string | number
    threadTs?: string
    replyBroadcast?: boolean
    linkNames?: boolean
    parse?: string
    unfurlLinks?: boolean
    unfurlMedia?: boolean
    asUser?: boolean
    signal?: AbortSignal
  }): Promise<ScheduledMessageResult> {
    const body: Record<string, unknown> = {
      channel: input.channel,
      post_at: typeof input.postAt === 'number' ? String(input.postAt) : input.postAt,
    }
    this.addOptional(body, 'text', input.text)
    this.addOptional(body, 'blocks', input.blocks)
    this.addOptional(body, 'attachments', input.attachments)
    this.addOptional(body, 'thread_ts', input.threadTs)
    this.addOptional(body, 'reply_broadcast', input.replyBroadcast)
    this.addOptional(body, 'link_names', input.linkNames)
    this.addOptional(body, 'parse', input.parse)
    this.addOptional(body, 'unfurl_links', input.unfurlLinks)
    this.addOptional(body, 'unfurl_media', input.unfurlMedia)
    this.addOptional(body, 'as_user', input.asUser)
    const raw = await this.request<RawScheduledMessage>('chat.scheduleMessage', {
      init: { method: 'POST', body: JSON.stringify(body) },
      signal: input.signal,
    })
    return {
      ok: true,
      channel: raw.channel ?? input.channel,
      scheduledMessageId: raw.scheduled_message_id ?? '',
      postAt: raw.post_at === undefined || raw.post_at === null ? null : String(raw.post_at),
      text: raw.text ?? null,
      user: raw.user ?? null,
    }
  }

  async deleteScheduledMessage(input: {
    channel: string
    scheduledMessageId: string
    asUser?: boolean
    signal?: AbortSignal
  }): Promise<ScheduledMessageDeleteResult> {
    const body: Record<string, unknown> = {
      channel: input.channel,
      scheduled_message_id: input.scheduledMessageId,
    }
    this.addOptional(body, 'as_user', input.asUser)
    const raw = await this.request<RawDeleteScheduledMessage>('chat.deleteScheduledMessage', {
      init: { method: 'POST', body: JSON.stringify(body) },
      signal: input.signal,
    })
    return {
      ok: true,
      channel: raw.channel ?? input.channel,
      scheduledMessageId: raw.scheduled_message_id ?? input.scheduledMessageId,
    }
  }

  async deleteMessage(input: {
    channel: string
    ts: string
    asUser?: boolean
    force?: boolean
    signal?: AbortSignal
  }): Promise<MessageDeleteResult> {
    const body: Record<string, string | boolean> = { channel: input.channel, ts: input.ts }
    this.addOptional(body, 'as_user', input.asUser)
    this.addOptional(body, 'force', input.force)
    const raw = await this.request<RawDelete>('chat.delete', {
      init: { method: 'POST', body: JSON.stringify(body) },
      signal: input.signal,
    })
    return { ok: true, channel: raw.channel ?? input.channel, ts: raw.ts ?? input.ts }
  }

  async addReaction(input: {
    channel: string
    timestamp: string
    name: string
    signal?: AbortSignal
  }): Promise<ReactionResult> {
    await this.request<RawReaction>('reactions.add', {
      init: { method: 'POST', body: JSON.stringify({ channel: input.channel, timestamp: input.timestamp, name: input.name }) },
      signal: input.signal,
    })
    return { ok: true, channel: input.channel, ts: input.timestamp }
  }

  private addOptional(target: Record<string, unknown>, key: string, value: unknown): void {
    if (value !== undefined) target[key] = value
  }

  private async request<T>(
    method: string,
    options: { params?: URLSearchParams; init?: RequestInit; signal?: AbortSignal } = {},
  ): Promise<T> {
    const controller = new AbortController()
    const onAbort = () => controller.abort(options.signal?.reason)
    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason)
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    if (this.timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(new Error(`Slack request timed out after ${this.timeoutMs}ms`)), this.timeoutMs)
    }
    try {
      const query = options.params?.toString() ?? ''
      const url = query ? `${this.baseUrl}/${method}?${query}` : `${this.baseUrl}/${method}`
      const headers: Record<string, string> = {
        accept: 'application/json',
        authorization: `Bearer ${this.token}`,
      }
      if (options.init?.body !== undefined && options.init?.body !== null) headers['content-type'] = 'application/json'
      const response = await this.fetchImpl(url, {
        ...options.init,
        headers: { ...headers, ...options.init?.headers },
        signal: controller.signal,
      })
      let data: unknown
      try {
        data = await response.json() as unknown
      } catch {
        data = null
      }
      if (!response.ok) {
        throw new SlackError(
          messageOf(data, `Slack API request failed with status ${response.status}`),
          response.status,
          codeOf(data),
        )
      }
      if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
        const code = codeOf(data)
        throw new SlackError(code ? `Slack API error: ${code}` : 'Slack API returned a failure response', response.status, code)
      }
      return data as T
    } finally {
      if (timer) clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
    }
  }
}
