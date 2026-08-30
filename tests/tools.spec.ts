import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SlackClient } from '../src/client.ts'
import { createTools } from '../src/index.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function exec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

function tools(client = new SlackClient({ fetchImpl: globalThis.fetch })) {
  return Object.fromEntries(createTools(client).map(t => [t.name, t]))
}

describe('tool definitions', () => {
  it('registers the planned Slack tool set', () => {
    expect(Object.keys(tools()).sort()).toEqual([
      'slack_add_reaction',
      'slack_auth_test',
      'slack_delete_message',
      'slack_delete_scheduled_message',
      'slack_get_channel',
      'slack_get_user',
      'slack_list_channel_members',
      'slack_list_channel_messages',
      'slack_list_channels',
      'slack_list_files',
      'slack_list_scheduled_messages',
      'slack_list_thread_replies',
      'slack_list_user_group_members',
      'slack_list_user_groups',
      'slack_list_users',
      'slack_post_message',
      'slack_schedule_message',
      'slack_search_messages',
      'slack_update_message',
    ])
  })

  it('returns business values without a token', async () => {
    const map = tools()
    expect(await map.slack_auth_test.execute({}, exec())).toMatchObject({ ok: false })
    expect(String((await map.slack_auth_test.execute({}, exec())).reason)).toContain('token')
    expect(await map.slack_list_channels.execute({}, exec())).toEqual({
      found: false,
      items: [],
      reason: 'Listing Slack channels requires a bot token.',
    })
    expect(await map.slack_post_message.execute({ text: 'hello' }, exec())).toMatchObject({ ok: false })
    expect(await map.slack_delete_message.execute({ ts: '1700000000.100000' }, exec())).toMatchObject({ ok: false })
    expect(await map.slack_list_channel_members.execute({}, exec())).toMatchObject({ found: false })
    expect(await map.slack_list_scheduled_messages.execute({}, exec())).toMatchObject({ found: false })
    expect(await map.slack_list_user_groups.execute({}, exec())).toMatchObject({ found: false })
    expect(await map.slack_list_user_group_members.execute({ usergroup: 'S1' }, exec())).toMatchObject({ found: false })
    expect(await map.slack_list_files.execute({}, exec())).toMatchObject({ found: false })
    expect(await map.slack_schedule_message.execute({ postAt: '1770000000' }, exec())).toMatchObject({ ok: false })
    expect(await map.slack_delete_scheduled_message.execute({ scheduledMessageId: 'Q123' }, exec())).toMatchObject({ ok: false })
  })

  it('uses the configured default channel and allows an explicit override', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: { id: 'C1', name: 'general', is_channel: true, num_members: 1 },
    }))
    const client = new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl })
    const map = tools(client)

    await map.slack_get_channel.execute({}, exec())
    expect(String(fetchImpl.mock.calls[0][0])).toContain('channel=general')

    await map.slack_get_channel.execute({ channel: 'incident' }, exec())
    expect(String(fetchImpl.mock.calls[1][0])).toContain('channel=incident')
  })

  it('list_channels forwards filters and clamps limits', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channels: [{ id: 'C1', name: 'general', is_channel: true }],
      response_metadata: { next_cursor: 'c2' },
    }))
    const client = new SlackClient({ token: 't', fetchImpl })
    const map = tools(client)
    const result = await map.slack_list_channels.execute({ types: 'public_channel', excludeArchived: true, limit: 999 }, exec())
    expect(result).toMatchObject({ found: true, items: [{ name: 'general' }], hasMore: true, nextCursor: 'c2' })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('types=public_channel')
    expect(url).toContain('limit=200')
  })

  it('maps channel and user not found errors to found:false', async () => {
    const channelMap = tools(new SlackClient({ token: 't', fetchImpl: vi.fn(async () => jsonResponse(200, { ok: false, error: 'channel_not_found' })) }))
    expect(await channelMap.slack_get_channel.execute({ channel: 'missing' }, exec())).toEqual({ found: false })
    expect(await channelMap.slack_list_channel_messages.execute({ channel: 'missing' }, exec())).toMatchObject({ found: false, items: [] })

    const userMap = tools(new SlackClient({ token: 't', fetchImpl: vi.fn(async () => jsonResponse(200, { ok: false, error: 'user_not_found' })) }))
    expect(await userMap.slack_get_user.execute({ user: 'missing' }, exec())).toEqual({ found: false })
  })

  it('search_messages clamps count and returns matches', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      messages: { matches: [{ channel: { id: 'C1', name: 'general' }, text: 'deploy ok', ts: '1', permalink: 'p' }] },
    }))
    const client = new SlackClient({ token: 't', fetchImpl })
    const map = tools(client)
    const result = await map.slack_search_messages.execute({ query: 'deploy', limit: 999 }, exec())
    expect(result).toMatchObject({ found: true, items: [{ text: 'deploy ok' }] })
    expect(String(fetchImpl.mock.calls[0][0])).toContain('count=100')
  })

  it('list_channel_members returns member ids and the next cursor', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      members: ['U1', 'U2'],
      response_metadata: { next_cursor: 'member-cursor-2' },
    }))
    const client = new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl })
    const map = tools(client)
    const result = await map.slack_list_channel_members.execute({ limit: 10 }, exec())
    expect(result).toMatchObject({ found: true, items: ['U1', 'U2'], nextCursor: 'member-cursor-2', hasMore: true })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/conversations.members?')
    expect(url).toContain('channel=general')
    expect(url).toContain('limit=10')
  })

  it('list_scheduled_messages forwards filters and maps items', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      scheduled_messages: [{
        id: 'Q123',
        channel_id: 'C1',
        post_at: '1770000000',
        date_created: 1700000000,
        text: 'hello later',
        user: 'U1',
      }],
      response_metadata: { next_cursor: 'scheduled-cursor-2' },
    }))
    const client = new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl })
    const map = tools(client)
    const result = await map.slack_list_scheduled_messages.execute({ limit: 10, oldest: '1700000000', latest: '1770000000' }, exec())

    expect(result).toMatchObject({ found: true, nextCursor: 'scheduled-cursor-2', hasMore: true })
    expect(result.items?.[0]).toMatchObject({ id: 'Q123', channelId: 'C1', postAt: '1770000000', text: 'hello later' })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/chat.scheduledMessages.list?')
    expect(url).toContain('channel=general')
    expect(url).toContain('limit=10')
    expect(url).toContain('oldest=1700000000')
    expect(url).toContain('latest=1770000000')
    expect(map.slack_list_scheduled_messages.presentCall!({ channel: 'general' })).toMatchObject({ card: 'generic', kind: 'search' })
  })

  it('list_user_groups and list_user_group_members forward filters and map results', async () => {
    const groupFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      usergroups: [{
        id: 'S1',
        name: 'On Call',
        description: 'Operators',
        handle: 'oncall',
        user_count: 2,
        users: ['U1', 'U2'],
      }],
    }))
    const groupMap = tools(new SlackClient({ token: 't', fetchImpl: groupFetch }))
    const groups = await groupMap.slack_list_user_groups.execute({ includeUsers: true, includeCount: true, includeDisabled: true }, exec())
    expect(groups).toMatchObject({ found: true, items: [{ name: 'On Call', handle: 'oncall', userCount: 2 }] })
    expect(String(groupFetch.mock.calls[0][0])).toContain('/usergroups.list?')
    expect(String(groupFetch.mock.calls[0][0])).toContain('include_users=true')
    expect(String(groupFetch.mock.calls[0][0])).toContain('include_count=true')
    expect(String(groupFetch.mock.calls[0][0])).toContain('include_disabled=true')

    const memberFetch = vi.fn(async () => jsonResponse(200, { ok: true, users: ['U1', 'U2'] }))
    const memberMap = tools(new SlackClient({ token: 't', fetchImpl: memberFetch }))
    const members = await memberMap.slack_list_user_group_members.execute({ usergroup: 'S1', includeDisabled: true }, exec())
    expect(members).toEqual({ found: true, items: ['U1', 'U2'], nextCursor: null, hasMore: false })
    expect(String(memberFetch.mock.calls[0][0])).toContain('/usergroups.users.list?')
    expect(String(memberFetch.mock.calls[0][0])).toContain('usergroup=S1')
    expect(String(memberFetch.mock.calls[0][0])).toContain('include_disabled=true')
  })

  it('list_files forwards filters and maps file metadata with paging', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      files: [{
        id: 'F1',
        name: 'incident.md',
        title: 'Incident notes',
        user: 'U1',
        channel: 'C1',
        created: 1700000000,
        timestamp: 1700000000.123,
        mimetype: 'text/markdown',
        filetype: 'text',
        size: 42,
      }],
      paging: { count: 1, total: 3, page: 1, pages: 3 },
    }))
    const client = new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl })
    const map = tools(client)
    const result = await map.slack_list_files.execute({ types: 'spaces', limit: 10, page: 1 }, exec())

    expect(result).toMatchObject({ found: true, page: 1, pages: 3, total: 3, hasMore: true })
    expect(result.items?.[0]).toMatchObject({ id: 'F1', name: 'incident.md', fileType: 'text', size: 42 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/files.list?')
    expect(url).toContain('channel=general')
    expect(url).toContain('count=10')
    expect(url).toContain('page=1')
    expect(url).toContain('types=spaces')
    expect(map.slack_list_files.presentCall!({ channel: 'general' })).toMatchObject({ card: 'generic', kind: 'search' })
  })

  it('post_message sends the write and presents an edit card', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      ts: '1700000000.100000',
      message: { text: 'hello', user: 'U1' },
    }))
    const client = new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl })
    const map = tools(client)

    const result = await map.slack_post_message.execute({ text: 'hello', mrkdwn: true }, exec())
    expect(result).toEqual({ ok: true, channel: 'C1', ts: '1700000000.100000', text: 'hello', user: 'U1' })
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({
      channel: 'general',
      text: 'hello',
      mrkdwn: true,
    })
    expect(map.slack_post_message.presentCall!({ channel: 'general', text: 'hello' })).toMatchObject({ card: 'generic', kind: 'edit' })
  })

  it('post_message and update_message forward blocks and attachments', async () => {
    const postFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      ts: '1700000001.100000',
      message: { text: null, user: 'U1' },
    }))
    const postMap = tools(new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl: postFetch }))
    await postMap.slack_post_message.execute({
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Release ready' } }],
      attachments: [{ color: '#36a64f', text: 'Deploy finished' }],
      username: 'Release Bot',
      iconEmoji: ':rocket:',
    }, exec())
    expect(JSON.parse(String((postFetch.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({
      channel: 'general',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Release ready' } }],
      attachments: [{ color: '#36a64f', text: 'Deploy finished' }],
      username: 'Release Bot',
      icon_emoji: ':rocket:',
    })

    const updateFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      ts: '1700000001.100000',
      message: { text: null, user: 'U1' },
    }))
    const updateMap = tools(new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl: updateFetch }))
    await updateMap.slack_update_message.execute({
      ts: '1700000001.100000',
      blocks: [{ type: 'section', text: { type: 'plain_text', text: 'Updated' } }],
      attachments: [{ color: '#ff0000', text: 'Rollback' }],
    }, exec())
    expect(JSON.parse(String((updateFetch.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({
      channel: 'general',
      ts: '1700000001.100000',
      blocks: [{ type: 'section', text: { type: 'plain_text', text: 'Updated' } }],
      attachments: [{ color: '#ff0000', text: 'Rollback' }],
    })
  })

  it('schedule_message and delete_scheduled_message map write results', async () => {
    const scheduleFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      scheduled_message_id: 'Q123',
      post_at: '1770000000',
      text: 'hello later',
      user: 'U1',
    }))
    const scheduleMap = tools(new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl: scheduleFetch }))
    const scheduled = await scheduleMap.slack_schedule_message.execute({ text: 'hello later', postAt: '1770000000' }, exec())
    expect(scheduled).toEqual({
      ok: true,
      channel: 'C1',
      scheduledMessageId: 'Q123',
      postAt: '1770000000',
      text: 'hello later',
      user: 'U1',
    })
    expect(JSON.parse(String((scheduleFetch.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({
      channel: 'general',
      post_at: '1770000000',
      text: 'hello later',
    })
    expect(scheduleMap.slack_schedule_message.presentCall!({ channel: 'general', postAt: '1770000000' })).toMatchObject({ card: 'generic', kind: 'edit' })

    const deleteFetch = vi.fn(async () => jsonResponse(200, { ok: true, channel: 'C1', scheduled_message_id: 'Q123' }))
    const deleteMap = tools(new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl: deleteFetch }))
    expect(await deleteMap.slack_delete_scheduled_message.execute({ scheduledMessageId: 'Q123' }, exec()))
      .toEqual({ ok: true, channel: 'general', scheduledMessageId: 'Q123' })
  })

  it('update_message, delete_message, and add_reaction map write results', async () => {
    const updateFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      ts: '1700000000.100000',
      message: { text: 'updated', user: 'U1' },
    }))
    const updateMap = tools(new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl: updateFetch }))
    expect(await updateMap.slack_update_message.execute({ ts: '1700000000.100000', text: 'updated' }, exec()))
      .toMatchObject({ ok: true, text: 'updated' })

    const deleteFetch = vi.fn(async () => jsonResponse(200, { ok: true, channel: 'C1', ts: '1700000000.100000' }))
    const deleteMap = tools(new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl: deleteFetch }))
    expect(await deleteMap.slack_delete_message.execute({ ts: '1700000000.100000' }, exec()))
      .toEqual({ ok: true, channel: 'C1', ts: '1700000000.100000' })

    const reactionFetch = vi.fn(async () => jsonResponse(200, { ok: true }))
    const reactionMap = tools(new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl: reactionFetch }))
    expect(await reactionMap.slack_add_reaction.execute({ timestamp: '1700000000.100000', name: '+1' }, exec()))
      .toEqual({ ok: true, channel: 'general', ts: '1700000000.100000' })
  })

  it('maps write failures to business values', async () => {
    const map = tools(new SlackClient({ token: 't', defaultChannel: 'general', fetchImpl: vi.fn(async () => jsonResponse(200, { ok: false, error: 'channel_not_found' })) }))
    expect(await map.slack_post_message.execute({ text: 'hello' }, exec())).toMatchObject({ ok: false, reason: 'Slack rejected the message: channel_not_found' })
    expect(await map.slack_update_message.execute({ ts: '1', text: 'x' }, exec())).toMatchObject({ ok: false })
    expect(await map.slack_schedule_message.execute({ postAt: '1770000000', text: 'x' }, exec())).toMatchObject({ ok: false })
    expect(await map.slack_delete_scheduled_message.execute({ scheduledMessageId: 'Q123' }, exec())).toMatchObject({ ok: false })
    expect(await map.slack_delete_message.execute({ ts: '1' }, exec())).toMatchObject({ ok: false })
    expect(await map.slack_add_reaction.execute({ timestamp: '1', name: '+1' }, exec())).toMatchObject({ ok: false })
  })

  it('renders channel and message values as pure text blocks', async () => {
    const map = tools()
    const channelBlocks = await (map.slack_get_channel.output as { render: (a: unknown, v: any) => unknown }).render({}, {
      found: true,
      id: 'C1',
      name: 'general',
      isChannel: true,
      isPrivate: false,
      isArchived: false,
      memberCount: 12,
      topic: 'Company updates',
      purpose: 'General',
    })
    expect(JSON.stringify(channelBlocks)).toContain('#general (C1)')
    expect(JSON.stringify(channelBlocks)).toContain('12 members')

    const messageBlocks = await (map.slack_list_channel_messages.output as { render: (a: unknown, v: any) => unknown }).render({}, {
      found: true,
      items: [{ ts: '1700000000.100000', user: 'U1', botId: null, text: 'hello' }],
    })
    expect(JSON.stringify(messageBlocks)).toContain('<U1> hello')
  })

  it('auth_test maps invalid Slack credentials to a business value', async () => {
    const map = tools(new SlackClient({ token: 'bad', fetchImpl: vi.fn(async () => jsonResponse(200, { ok: false, error: 'invalid_auth' })) }))
    expect(await map.slack_auth_test.execute({}, exec())).toMatchObject({ ok: false, reason: 'Slack rejected the token: invalid_auth' })
  })

  it('does not convert HTTP auth failures in write tools into business values', async () => {
    const map = tools(new SlackClient({ token: 'bad', defaultChannel: 'general', fetchImpl: vi.fn(async () => jsonResponse(401, { ok: false, error: 'invalid_auth' })) }))
    await expect(map.slack_post_message.execute({ text: 'hello' }, exec())).rejects.toMatchObject({ name: 'SlackError', status: 401 })
  })
})
