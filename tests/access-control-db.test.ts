import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecipientProfile } from '@/lib/types'

const queryMysqlMock = vi.hoisted(() => vi.fn())

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'audit-uuid-1')
}))

vi.mock('@/lib/db', () => ({
  queryMysql: (...args: unknown[]) => queryMysqlMock(...args)
}))

import {
  insertAuditLog,
  listAuditLogs,
  listCompaniesForUser,
  upsertRecipientProfile
} from '@/lib/access-control-db'

describe('access-control-db', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists companies with different queries for admins and members', async () => {
    queryMysqlMock
      .mockResolvedValueOnce([
        { id: 'company-1', slug: 'acme', name: 'Acme', status: 'active', created_by_user_id: 'u-1', created_at: '2026-03-29 00:00:00', updated_at: '2026-03-29 00:00:00' }
      ])
      .mockResolvedValueOnce([
        { id: 'company-2', slug: 'beta', name: 'Beta', status: 'active', created_by_user_id: 'u-2', created_at: '2026-03-29 00:00:00', updated_at: '2026-03-29 00:00:00' }
      ])
      .mockResolvedValueOnce([{ cnt: 1 }]) // COUNT query for pagination

    const adminItems = await listCompaniesForUser('user-1', true)
    const memberItems = await listCompaniesForUser('user-1', false, { pagination: { page: 1, pageSize: 10 } })

    expect(queryMysqlMock.mock.calls[0][0]).toContain('FROM wlfi_companies ORDER BY created_at DESC')
    expect(queryMysqlMock.mock.calls[1][0]).toContain('INNER JOIN wlfi_company_memberships')
    expect((adminItems as unknown[])[0]).toMatchObject({ id: 'company-1', slug: 'acme' })
    const memberResult = memberItems as { items: unknown[]; total: number }
    expect(memberResult.items[0]).toMatchObject({ id: 'company-2', slug: 'beta' })
    expect(memberResult.total).toBe(1)
  })

  it('serializes metadata when inserting audit logs and parses it when listing', async () => {
    queryMysqlMock
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        {
          id: 'audit-1',
          company_id: 'company-1',
          actor_user_id: 'u-1',
          actor_role: 'platform_admin',
          action: 'test.action',
          target_type: 'task',
          target_id: 'task-1',
          summary: 'summary',
          metadata: '{"hello":"world"}',
          created_at: '2026-03-29 00:00:00'
        }
      ])

    const insertedId = await insertAuditLog({
      companyId: 'company-1',
      actorUserId: 'u-1',
      actorRole: 'platform_admin',
      action: 'test.action',
      targetType: 'task',
      targetId: 'task-1',
      summary: 'summary',
      metadata: { hello: 'world' }
    })

    const logs = await listAuditLogs('company-1')

    expect(insertedId).toBe('audit-uuid-1')
    expect(queryMysqlMock.mock.calls[0][1][8]).toBe('{"hello":"world"}')
    expect((logs as unknown[])[0]).toMatchObject({
      id: 'audit-1',
      metadata: { hello: 'world' }
    })
  })

  it('inserts or updates recipient profiles based on existing external identity', async () => {
    const profile: RecipientProfile = {
      id: 'recipient-1',
      type: 'individual',
      displayName: 'Alice',
      githubLogin: 'alice',
      githubUserId: '100',
      walletAddress: '0xwallet',
      externalUserId: 'ext-1',
      identitySource: 'hybrid',
      ownerUserId: 'u-1',
      status: 'active',
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z'
    }

    queryMysqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        {
          id: 'recipient-1',
          type: 'external_user',
          display_name: 'Alice',
          github_login: 'alice',
          github_user_id: '100',
          wallet_address: '0xwallet',
          external_user_id: 'ext-1',
          identity_source: 'lark',
          owner_user_id: 'u-1',
          status: 'active',
          created_at: '2026-03-29 00:00:00',
          updated_at: '2026-03-29 00:00:00'
        }
      ])

    const inserted = await upsertRecipientProfile(profile)
    expect(inserted).toMatchObject({ id: 'recipient-1', externalUserId: 'ext-1' })
    expect(queryMysqlMock.mock.calls[1][0]).toContain('INSERT INTO wlfi_recipient_profiles')

    queryMysqlMock.mockReset()
    queryMysqlMock
      .mockResolvedValueOnce([
        {
          id: 'recipient-1',
          type: 'external_user',
          display_name: 'Alice',
          github_login: 'alice',
          github_user_id: '100',
          wallet_address: '0xwallet',
          external_user_id: 'ext-1',
          identity_source: 'lark',
          owner_user_id: 'u-1',
          status: 'active',
          created_at: '2026-03-29 00:00:00',
          updated_at: '2026-03-29 00:00:00'
        }
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        {
          id: 'recipient-1',
          type: 'external_user',
          display_name: 'Alice Updated',
          github_login: 'alice',
          github_user_id: '100',
          wallet_address: '0xwallet',
          external_user_id: 'ext-1',
          identity_source: 'lark',
          owner_user_id: 'u-1',
          status: 'active',
          created_at: '2026-03-29 00:00:00',
          updated_at: '2026-03-29 01:00:00'
        }
      ])

    const updated = await upsertRecipientProfile({
      ...profile,
      displayName: 'Alice Updated',
      updatedAt: '2026-03-29T01:00:00.000Z'
    })

    expect(queryMysqlMock.mock.calls[1][0]).toContain('UPDATE wlfi_recipient_profiles')
    expect(updated).toMatchObject({ displayName: 'Alice Updated' })
  })
})
