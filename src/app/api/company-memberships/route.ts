import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getActorRoleLabel, hasCompanyCapability, isPlatformAdmin, requireInternalUser } from '@/lib/auth'
import { parsePaginationParams } from '@/lib/pagination'
import {
  getCompanyById,
  getMembership,
  getMembershipForIdentity,
  getMembershipById,
  insertAuditLog,
  insertMembership,
  listMemberships,
  updateMembership
} from '@/lib/access-control-db'
import { CompanyMembership, CompanyRole } from '@/lib/types'
import { parseBody, evmAddressSchema } from '@/lib/validation'

const createMembershipSchema = z.object({
  action: z.literal('create').optional(),
  companyId: z.string().optional(),
  userId: z.string().min(1, 'userId is required'),
  role: z.string().optional(),
  githubLogin: z.string().optional(),
  githubUserId: z.string().optional(),
  walletAddress: evmAddressSchema.optional().or(z.literal('')),
  status: z.string().optional()
}).passthrough()

const updateRoleSchema = z.object({
  action: z.literal('updateRole'),
  companyId: z.string().optional(),
  id: z.string().min(1, 'membership id is required'),
  role: z.string().min(1, 'role is required')
}).passthrough()

const disableMemberSchema = z.object({
  action: z.literal('disable'),
  companyId: z.string().optional(),
  id: z.string().min(1, 'membership id is required')
}).passthrough()

const acceptInviteSchema = z.object({
  action: z.literal('acceptInvite'),
  companyId: z.string().optional()
}).passthrough()

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const pagination = parsePaginationParams(url.searchParams)
  const companyId = url.searchParams.get('companyId') || auth.session.activeCompanyId
  if (!companyId) return NextResponse.json({ error: 'Missing companyId' }, { status: 400 })

  const mine = await getMembershipForIdentity(companyId, {
    userId: auth.session.userId,
    githubLogin: auth.session.githubLogin,
    githubUserId: auth.session.githubUserId,
    walletAddress: auth.session.walletAddress
  })
  if (!isPlatformAdmin(auth.session) && !hasCompanyCapability(mine?.role, 'member.manage')) {
    return NextResponse.json({ error: 'Not authorized to view this company\'s members' }, { status: 403 })
  }
  const items = await listMemberships(companyId, { pagination: pagination || undefined })
  return NextResponse.json(pagination ? {
    items,
    pagination: { page: pagination.page, pageSize: pagination.pageSize }
  } : items)
}

export async function POST(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || 'create')
  const companyId = String(body?.companyId || auth.session.activeCompanyId || '')
  if (!companyId) return NextResponse.json({ error: 'Missing companyId' }, { status: 400 })

  const company = await getCompanyById(companyId)
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const myMembership = await getMembershipForIdentity(companyId, {
    userId: auth.session.userId,
    githubLogin: auth.session.githubLogin,
    githubUserId: auth.session.githubUserId,
    walletAddress: auth.session.walletAddress
  })
  const allowed = isPlatformAdmin(auth.session) || hasCompanyCapability(myMembership?.role, 'member.manage')
  if (!allowed) return NextResponse.json({ error: 'Not authorized to manage company members' }, { status: 403 })

  if (action === 'create') {
    const validation = parseBody(createMembershipSchema, body)
    if (!validation.success) return validation.response
    const userId = String(body?.userId || '').trim()
    const role = String(body?.role || 'company_viewer') as CompanyRole
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const existing = await getMembership(companyId, userId)
    if (existing) return NextResponse.json({ error: 'Member already exists' }, { status: 400 })

    const now = new Date().toISOString()
    const membership: CompanyMembership = {
      id: uuidv4(),
      companyId,
      userId,
      githubLogin: body?.githubLogin ? String(body.githubLogin) : undefined,
      githubUserId: body?.githubUserId ? String(body.githubUserId) : undefined,
      walletAddress: body?.walletAddress ? String(body.walletAddress) : undefined,
      role,
      status: body?.status === 'active' ? 'active' : 'invited',
      invitedByUserId: auth.session.userId,
      invitedAt: now,
      acceptedAt: body?.status === 'active' ? now : undefined,
      createdAt: now,
      updatedAt: now
    }
    const created = await insertMembership(membership)
    await insertAuditLog({
      companyId,
      actorUserId: auth.session.userId,
      actorRole: getActorRoleLabel({ session: auth.session, membershipRole: myMembership?.role }),
      action: 'company_membership.create',
      targetType: 'company_membership',
      targetId: membership.id,
      summary: `Invited member ${userId} to join ${company.name}`,
      metadata: { role },
      createdAt: now
    })
    return NextResponse.json({ success: true, membership: created })
  }

  if (action === 'updateRole') {
    const validation = parseBody(updateRoleSchema, body)
    if (!validation.success) return validation.response
    const id = String(body?.id || '')
    const target = await getMembershipById(id)
    if (target && target.companyId !== companyId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    const updated = await updateMembership(id, { role: body?.role })
    await insertAuditLog({
      companyId,
      actorUserId: auth.session.userId,
      actorRole: getActorRoleLabel({ session: auth.session, membershipRole: myMembership?.role }),
      action: 'company_membership.update_role',
      targetType: 'company_membership',
      targetId: target.id,
      summary: `Updated role of member ${target.userId} to ${body?.role}`,
      metadata: { role: body?.role },
      createdAt: new Date().toISOString()
    })
    return NextResponse.json({ success: true, membership: updated })
  }

  if (action === 'disable') {
    const validation = parseBody(disableMemberSchema, body)
    if (!validation.success) return validation.response
    const id = String(body?.id || '')
    const target = await getMembershipById(id)
    if (target && target.companyId !== companyId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    const updated = await updateMembership(id, { status: 'disabled' })
    await insertAuditLog({
      companyId,
      actorUserId: auth.session.userId,
      actorRole: getActorRoleLabel({ session: auth.session, membershipRole: myMembership?.role }),
      action: 'company_membership.disable',
      targetType: 'company_membership',
      targetId: target.id,
      summary: `Disabled member ${target.userId}`,
      metadata: {},
      createdAt: new Date().toISOString()
    })
    return NextResponse.json({ success: true, membership: updated })
  }

  if (action === 'acceptInvite') {
    const validation = parseBody(acceptInviteSchema, body)
    if (!validation.success) return validation.response
    const target = await getMembership(companyId, auth.session.userId)
    if (!target) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    const updated = await updateMembership(target.id, {
      status: 'active',
      acceptedAt: new Date().toISOString()
    })
    return NextResponse.json({ success: true, membership: updated })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
