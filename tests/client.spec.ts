import { describe, expect, it, vi } from 'vitest'
import { SlackClient, SlackError } from '../src/client.ts'

/** Deterministic DNS so tests never depend on real resolution. */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 as const }]


function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('SlackClient', () => {
  it('authTest sends the bot token to the Slack Web API base URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      team_id: 'T1',
      team: 'Acme',
      url: 'https://acme.slack.com',
      user_id: 'U1',
      user: 'alice',
      bot_id: 'B1',
      is_enterprise_install: false,
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 'xoxb-test', fetchImpl })
    const auth = await client.authTest()

    expect(auth).toEqual({
      ok: true,
      teamId: 'T1',
      teamName: 'Acme',
      url: 'https://acme.slack.com',
      userId: 'U1',
      userName: 'alice',
      botId: 'B1',
      isEnterpriseInstall: false,
    })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://slack.com/api/auth.test')
    expect(init.headers).toMatchObject({ authorization: 'Bearer xoxb-test' })
  })

  it('listChannels maps channel fields and returns the next cursor', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channels: [{
        id: 'C1',
        name: 'general',
        name_normalized: 'general',
        is_channel: true,
        is_private: false,
        is_shared: false,
        is_archived: false,
        is_member: true,
        is_general: true,
        num_members: 12,
        created: 1700000000,
        topic: { value: 'Company updates' },
        purpose: { value: 'General discussion' },
      }],
      response_metadata: { next_cursor: 'cursor-2' },
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl })
    const result = await client.listChannels({ types: 'public_channel,private_channel', excludeArchived: true, limit: 5 })

    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('cursor-2')
    expect(result.items[0]).toMatchObject({
      id: 'C1',
      name: 'general',
      isChannel: true,
      isMember: true,
      isGeneral: true,
      memberCount: 12,
      created: '2023-11-14T22:13:20.000Z',
      topic: 'Company updates',
      purpose: 'General discussion',
    })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/conversations.list?')
    expect(url).toContain('limit=5')
    expect(url).toContain('types=public_channel%2Cprivate_channel')
    expect(url).toContain('exclude_archived=true')
  })

  it('getChannel calls conversations.info and maps the nested channel', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: { id: 'C9', name: 'incident-room', name_normalized: 'incident-room', is_private: true, num_members: 3 },
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl })
    const channel = await client.getChannel('C9')
    expect(channel).toMatchObject({ id: 'C9', name: 'incident-room', isPrivate: true, memberCount: 3 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/conversations.info?channel=C9')
  })

  it('listMessages sends history filters and maps hasMore', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      has_more: true,
      messages: [{
        type: 'message',
        user: 'U1',
        ts: '1700000000.100000',
        text: 'hello',
        reply_count: 2,
        reply_users: ['U2'],
        reactions: [{ name: '+1', count: 3 }],
      }],
      response_metadata: { next_cursor: 'next' },
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl })
    const result = await client.listMessages('C1', {
      limit: 50,
      oldest: '1700000000',
      latest: '1700000100',
      inclusive: true,
    })
    expect(result).toMatchObject({ hasMore: true, nextCursor: 'next' })
    expect(result.items[0]).toMatchObject({
      user: 'U1',
      ts: '1700000000.100000',
      text: 'hello',
      replyCount: 2,
      reactions: [{ name: '+1', count: 3 }],
    })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/conversations.history?')
    expect(url).toContain('channel=C1')
    expect(url).toContain('limit=50')
    expect(url).toContain('oldest=1700000000')
    expect(url).toContain('latest=1700000100')
    expect(url).toContain('inclusive=true')
  })

  it('listReplies sends thread ts and maps thread messages', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      messages: [{ type: 'message', user: 'U2', ts: '1700000000.200000', thread_ts: '1700000000.100000', text: 'reply' }],
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl })
    const result = await client.listReplies('C1', '1700000000.100000', { limit: 5 })
    expect(result.items[0]).toMatchObject({ user: 'U2', threadTs: '1700000000.100000', text: 'reply' })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/conversations.replies?')
    expect(url).toContain('ts=1700000000.100000')
  })

  it('listUsers and getUser map Slack profile fields', async () => {
    const listFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      members: [{
        id: 'U1',
        team_id: 'T1',
        name: 'alice',
        real_name: 'Alice',
        deleted: false,
        is_bot: false,
        is_admin: true,
        profile: {
          display_name: 'Alice A',
          email: 'alice@example.com',
          title: 'Engineer',
          image_72: 'https://example.com/a.png',
          status_text: 'On call',
          status_emoji: ':bell:',
        },
      }],
      response_metadata: { next_cursor: 'u2' },
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: listFetch })
    const users = await client.listUsers({ limit: 10 })
    expect(users).toMatchObject({ hasMore: true, nextCursor: 'u2' })
    expect(users.items[0]).toMatchObject({
      id: 'U1',
      name: 'alice',
      displayName: 'Alice A',
      email: 'alice@example.com',
      isAdmin: true,
      statusText: 'On call',
      statusEmoji: ':bell:',
    })

    const getFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      user: {
        id: 'U1',
        name: 'alice',
        tz: 'Asia/Shanghai',
        tz_label: 'China Standard Time',
        profile: { real_name: 'Alice', image_72: 'https://example.com/a.png' },
      },
    }))
    const getClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: getFetch })
    const user = await getClient.getUser('U1')
    expect(user).toMatchObject({ id: 'U1', tz: 'Asia/Shanghai', tzLabel: 'China Standard Time' })
    const [url] = getFetch.mock.calls[0] as [string]
    expect(url).toContain('/users.info?user=U1')
  })

  it('listChannelMembers sends conversation filters and maps raw member ids', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      members: ['U1', 'U2'],
      response_metadata: { next_cursor: 'member-cursor-2' },
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl })
    const result = await client.listChannelMembers('C1', { limit: 5 })

    expect(result).toMatchObject({ items: ['U1', 'U2'], nextCursor: 'member-cursor-2', hasMore: true })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/conversations.members?')
    expect(url).toContain('channel=C1')
    expect(url).toContain('limit=5')
  })

  it('listScheduledMessages maps scheduled messages and pagination', async () => {
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
      has_more: true,
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl })
    const result = await client.listScheduledMessages('C1', {
      limit: 5,
      cursor: 'scheduled-cursor-1',
      oldest: '1700000000',
      latest: '1770000000',
    })

    expect(result).toMatchObject({
      nextCursor: 'scheduled-cursor-2',
      hasMore: true,
    })
    expect(result.items[0]).toMatchObject({
      id: 'Q123',
      channelId: 'C1',
      postAt: '1770000000',
      createdAt: '2023-11-14T22:13:20.000Z',
      text: 'hello later',
      user: 'U1',
    })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/chat.scheduledMessages.list?')
    expect(url).toContain('channel=C1')
    expect(url).toContain('limit=5')
    expect(url).toContain('oldest=1700000000')
    expect(url).toContain('latest=1770000000')
  })

  it('listUserGroups and listUserGroupMembers map groups and member ids', async () => {
    const groupFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      usergroups: [{
        id: 'S1',
        team_id: 'T1',
        is_usergroup: true,
        name: 'On Call',
        description: 'Operators',
        handle: 'oncall',
        is_external: false,
        created_by: 'U1',
        updated_by: 'U2',
        user_count: 2,
        users: ['U1', 'U2'],
      }],
    }))
    const groupClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: groupFetch })
    const groups = await groupClient.listUserGroups({ includeUsers: true, includeCount: true, includeDisabled: true })
    expect(groups.items[0]).toMatchObject({
      id: 'S1',
      name: 'On Call',
      handle: 'oncall',
      userCount: 2,
      users: ['U1', 'U2'],
      isExternal: false,
    })
    const [groupUrl] = groupFetch.mock.calls[0] as [string]
    expect(groupUrl).toContain('/usergroups.list?')
    expect(groupUrl).toContain('include_users=true')
    expect(groupUrl).toContain('include_count=true')
    expect(groupUrl).toContain('include_disabled=true')

    const memberFetch = vi.fn(async () => jsonResponse(200, { ok: true, users: ['U1', 'U2'] }))
    const memberClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: memberFetch })
    const members = await memberClient.listUserGroupMembers('S1', { includeDisabled: true })
    expect(members).toEqual({ items: ['U1', 'U2'], nextCursor: null, hasMore: false })
    const [memberUrl] = memberFetch.mock.calls[0] as [string]
    expect(memberUrl).toContain('/usergroups.users.list?')
    expect(memberUrl).toContain('usergroup=S1')
    expect(memberUrl).toContain('include_disabled=true')
  })

  it('listFiles maps file metadata and file-list paging', async () => {
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
        updated: 1700000100,
        mimetype: 'text/markdown',
        filetype: 'text',
        size: 42,
        permalink: 'https://acme.slack.com/files/U1/F1/incident.md',
        url_private: 'https://files.slack.com/files-pri/T1-F1',
        is_public: false,
      }],
      paging: { count: 1, total: 3, page: 1, pages: 3 },
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl })
    const result = await client.listFiles({ channel: 'C1', user: 'U1', types: 'spaces', tsFrom: '1', tsTo: '2', limit: 1, page: 1 })

    expect(result).toMatchObject({ page: 1, pages: 3, total: 3, hasMore: true })
    expect(result.items[0]).toMatchObject({
      id: 'F1',
      name: 'incident.md',
      title: 'Incident notes',
      userId: 'U1',
      channelId: 'C1',
      createdAt: '2023-11-14T22:13:20.000Z',
      timestamp: '1700000000.123',
      updatedAt: '2023-11-14T22:15:00.000Z',
      mimeType: 'text/markdown',
      fileType: 'text',
      size: 42,
      permalink: 'https://acme.slack.com/files/U1/F1/incident.md',
      isPublic: false,
    })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/files.list?')
    expect(url).toContain('count=1')
    expect(url).toContain('page=1')
    expect(url).toContain('channel=C1')
    expect(url).toContain('user=U1')
    expect(url).toContain('types=spaces')
    expect(url).toContain('ts_from=1')
    expect(url).toContain('ts_to=2')
  })

  it('searchMessages sends the query and maps matches', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      messages: {
        matches: [{
          type: 'message',
          channel: { id: 'C1', name: 'general' },
          user: 'U1',
          username: 'alice',
          text: 'deployment failed',
          permalink: 'https://acme.slack.com/archives/C1/p123',
          ts: '1700000000.100000',
          team: 'T1',
        }],
      },
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl })
    const result = await client.searchMessages('deployment failed', { limit: 5 })
    expect(result.items[0]).toMatchObject({
      channelId: 'C1',
      channelName: 'general',
      username: 'alice',
      text: 'deployment failed',
      permalink: 'https://acme.slack.com/archives/C1/p123',
      ts: '1700000000.100000',
    })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/search.messages?')
    expect(url).toContain('query=deployment+failed')
    expect(url).toContain('count=5')
  })

  it('postMessage sends a JSON body and maps the created message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      ts: '1700000000.300000',
      message: { text: 'hello', user: 'U1' },
    }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl })
    const result = await client.postMessage({ channel: 'general', text: 'hello', mrkdwn: true, threadTs: '1700000000.100000' })
    expect(result).toEqual({ ok: true, channel: 'C1', ts: '1700000000.300000', text: 'hello', user: 'U1' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://slack.com/api/chat.postMessage')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      channel: 'general',
      text: 'hello',
      thread_ts: '1700000000.100000',
      mrkdwn: true,
    })
  })

  it('postMessage and updateMessage send Block Kit, attachments, and sender overrides', async () => {
    const postFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      ts: '1700000001.100000',
      message: { text: null, user: 'U1' },
    }))
    const postClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: postFetch })
    await postClient.postMessage({
      channel: 'C1',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Release ready' } }],
      attachments: [{ color: '#36a64f', text: 'Deploy finished' }],
      parse: 'full',
      username: 'Release Bot',
      iconEmoji: ':rocket:',
      iconUrl: 'https://example.com/icon.png',
      asUser: true,
    })
    expect(JSON.parse(String((postFetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      channel: 'C1',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Release ready' } }],
      attachments: [{ color: '#36a64f', text: 'Deploy finished' }],
      parse: 'full',
      username: 'Release Bot',
      icon_emoji: ':rocket:',
      icon_url: 'https://example.com/icon.png',
      as_user: true,
    })

    const updateFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      ts: '1700000001.100000',
      message: { text: null, user: 'U1' },
    }))
    const updateClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: updateFetch })
    await updateClient.updateMessage({
      channel: 'C1',
      ts: '1700000001.100000',
      blocks: [{ type: 'section', text: { type: 'plain_text', text: 'Updated' } }],
      attachments: [{ color: '#ff0000', text: 'Rollback' }],
      parse: 'none',
    })
    expect(JSON.parse(String((updateFetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      channel: 'C1',
      ts: '1700000001.100000',
      blocks: [{ type: 'section', text: { type: 'plain_text', text: 'Updated' } }],
      attachments: [{ color: '#ff0000', text: 'Rollback' }],
      parse: 'none',
    })
  })

  it('scheduleMessage and deleteScheduledMessage send write bodies and map results', async () => {
    const scheduleFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      scheduled_message_id: 'Q123',
      post_at: '1770000000',
      text: 'hello later',
      user: 'U1',
    }))
    const scheduleClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: scheduleFetch })
    const scheduled = await scheduleClient.scheduleMessage({
      channel: 'C1',
      text: 'hello later',
      blocks: [{ type: 'section', text: { type: 'plain_text', text: 'Later' } }],
      postAt: 1770000000,
      asUser: true,
    })
    expect(scheduled).toEqual({
      ok: true,
      channel: 'C1',
      scheduledMessageId: 'Q123',
      postAt: '1770000000',
      text: 'hello later',
      user: 'U1',
    })
    expect(JSON.parse(String((scheduleFetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      channel: 'C1',
      post_at: '1770000000',
      text: 'hello later',
      blocks: [{ type: 'section', text: { type: 'plain_text', text: 'Later' } }],
      as_user: true,
    })

    const deleteFetch = vi.fn(async () => jsonResponse(200, { ok: true, channel: 'C1', scheduled_message_id: 'Q123' }))
    const deleteClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: deleteFetch })
    expect(await deleteClient.deleteScheduledMessage({ channel: 'C1', scheduledMessageId: 'Q123', asUser: true }))
      .toEqual({ ok: true, channel: 'C1', scheduledMessageId: 'Q123' })
    expect(JSON.parse(String((deleteFetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      channel: 'C1',
      scheduled_message_id: 'Q123',
      as_user: true,
    })
  })

  it('updateMessage, deleteMessage, and addReaction send write bodies and map results', async () => {
    const updateFetch = vi.fn(async () => jsonResponse(200, {
      ok: true,
      channel: 'C1',
      ts: '1700000000.100000',
      message: { text: 'updated', user: 'U1' },
    }))
    const updateClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: updateFetch })
    expect(await updateClient.updateMessage({ channel: 'C1', ts: '1700000000.100000', text: 'updated', asUser: true }))
      .toMatchObject({ ok: true, text: 'updated' })
    const updateBody = JSON.parse(String((updateFetch.mock.calls[0] as [string, RequestInit])[1].body))
    expect(updateBody).toEqual({ channel: 'C1', ts: '1700000000.100000', text: 'updated', as_user: true })

    const deleteFetch = vi.fn(async () => jsonResponse(200, { ok: true, channel: 'C1', ts: '1700000000.100000' }))
    const deleteClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: deleteFetch })
    expect(await deleteClient.deleteMessage({ channel: 'C1', ts: '1700000000.100000', force: true }))
      .toEqual({ ok: true, channel: 'C1', ts: '1700000000.100000' })
    const deleteBody = JSON.parse(String((deleteFetch.mock.calls[0] as [string, RequestInit])[1].body))
    expect(deleteBody).toEqual({ channel: 'C1', ts: '1700000000.100000', force: true })

    const reactionFetch = vi.fn(async () => jsonResponse(200, { ok: true }))
    const reactionClient = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: reactionFetch })
    expect(await reactionClient.addReaction({ channel: 'C1', timestamp: '1700000000.100000', name: '+1' }))
      .toEqual({ ok: true, channel: 'C1', ts: '1700000000.100000' })
    const reactionBody = JSON.parse(String((reactionFetch.mock.calls[0] as [string, RequestInit])[1].body))
    expect(reactionBody).toEqual({ channel: 'C1', timestamp: '1700000000.100000', name: '+1' })
  })

  it('throws SlackError with a code when Slack returns ok:false', async () => {
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', fetchImpl: vi.fn(async () => jsonResponse(200, { ok: false, error: 'channel_not_found' })) })
    await expect(client.getChannel('missing')).rejects.toMatchObject({ name: 'SlackError', status: 200, code: 'channel_not_found' })
  })

  it('throws SlackError for HTTP failures', async () => {
    const client = new SlackClient({ lookupImpl: publicLookup, token: 'bad', fetchImpl: vi.fn(async () => jsonResponse(401, { ok: false, error: 'invalid_auth' })) })
    await expect(client.authTest()).rejects.toMatchObject({ name: 'SlackError', status: 401, code: 'invalid_auth' })
  })

  it('strips a trailing slash from a baseUrl override', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, team_id: 'T1', team: 'Acme', url: 'u', user_id: 'U1', user: 'alice' }))
    const client = new SlackClient({ lookupImpl: publicLookup, token: 't', baseUrl: 'https://slack.example.com/api/', fetchImpl })
    await client.authTest()
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://slack.example.com/api/auth.test')
  })
})

describe('Slack endpoint security', () => {
  const valid = { token: 't' }

  it('rejects invalid base URLs without exposing their contents', () => {
    for (const baseUrl of [
      'slack.com/api',
      'ftp://slack.com/api',
      'https://user:secretslack.com/api',
      'https://slack.com/api?token=secret',
      'https://slack.com/api#fragment',
    ]) {
      let error: unknown
      try { new SlackClient({ ...valid, baseUrl }) } catch (thrown) { error = thrown }
      expect(error).toBeInstanceOf(SlackError)
      expect(String(error)).not.toContain('secret')
    }
  })

  it('rejects literal local, private, and reserved addresses before fetch', async () => {
    for (const baseUrl of [
      'http://localhost',
      'http://service.localhost',
      'http://service.local',
      'http://127.0.0.1',
      'http://169.254.169.254',
      'http://10.0.0.1',
      'http://192.168.1.1',
      'http://192.0.2.1',
      'http://198.18.0.1',
      'http://224.0.0.1',
      'http://192.175.48.1',
      'http://[::1]',
      'http://[fc00::1]',
      'http://[fe80::1]',
      'http://[fec0::1]',
      'http://[2001:db8::1]',
      'http://[2001:3::1]',
      'http://[2001:4:112::1]',
      'http://[2001:30::1]',
      'http://[5f00::1]',
      'http://[100:0:0:1::1]',
      'http://[2620:4f:8000::1]',
      'http://[64:ff9b::7f00:1]',
      'http://[ff02::1]',
    ]) {
      const fetchImpl = vi.fn()
      await expect(new SlackClient({ ...valid, baseUrl, fetchImpl }).authTest()).rejects.toMatchObject({ name: 'SlackError' })
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('fails closed on blocked, failed, empty, or inconsistent DNS results', async () => {
    for (const lookupImpl of [
      async () => [{ address: '192.168.1.10', family: 4 as const }],
      async () => [{ address: '93.184.216.34', family: 4 as const }, { address: '169.254.169.254', family: 4 as const }],
      async () => { throw new Error('dns failure') },
      async () => [],
      async () => [{ address: '2001:db8::1', family: 4 as const }],
    ]) {
      const fetchImpl = vi.fn()
      await expect(new SlackClient({ ...valid, baseUrl: 'https://slack.example.test', fetchImpl, lookupImpl }).authTest()).rejects.toMatchObject({ name: 'SlackError' })
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('allows a public endpoint that resolves to a public address', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    await new SlackClient({ ...valid, baseUrl: 'https://slack.example.test', fetchImpl, lookupImpl: publicLookup }).authTest().catch(() => undefined)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
