import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getActorRoleLabel, hasCompanyCapability, isPlatformAdmin, requireInternalUser, withSession } from '@/lib/auth'
import {
  getCompanyById,
  getCompanyBySlug,
  getMembership,
  insertAuditLog,
  insertCompany,
  insertMembership,
  listCompanyWallets,
  listCompaniesForUser,
  listMemberships,
  updateCompanyFields
} from '@/lib/access-control-db'
import { deriveCompanyOnboardingState } from '@/lib/onboarding'
import { parsePaginationParams } from '@/lib/pagination'
import { listIntegrationHealthStatesDb, listRepoConfigsDb, listTaskBountiesDb } from '@/lib/runtime-data-db'
import { Company, CompanyMembership } from '@/lib/types'
import { parseBody } from '@/lib/validation'

const createCompanySchema = z.object({
  action: z.literal('create').optional(),
  name: z.string().min(1, 'Company name is required'),
  slug: z.string().optional(),
  githubOrgLogin: z.string().optional(),
  githubOrgId: z.string().optional(),
  projectManagementTool: z.string().optional(),
  projectManagementToolLabel: z.string().optional(),
  meegleWorkspaceId: z.string().optional(),
  meegleProjectKey: z.string().optional(),
  meegleViewUrl: z.string().optional(),
  meegleMcpToken: z.string().optional(),
  documentationTool: z.string().optional(),
  documentationToolLabel: z.string().optional(),
  larkWebhookUrl: z.string().optional(),
  larkWebhookSecret: z.string().optional(),
  larkDefaultReceiveId: z.string().optional(),
  description: z.string().optional(),
  websiteUrl: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  defaultRepoConfigId: z.string().optional()
}).passthrough()

const updateCompanySchema = z.object({
  action: z.literal('update'),
  id: z.string().min(1, 'Company id is required')
}).passthrough()

const switchActiveCompanySchema = z.object({
  action: z.literal('switchActiveCompany'),
  id: z.string().min(1, 'Company id is required')
}).passthrough()

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function GET(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response
  const url = new URL(req.url)
  const pagination = parsePaginationParams(url.searchParams)
  const result = await listCompaniesForUser(auth.session.userId, isPlatformAdmin(auth.session), { pagination: pagination || undefined })
  const companies = Array.isArray(result) ? result : result.items
  const total = Array.isArray(result) ? companies.length : result.total
  const [repos, tasks, integrationStates] = await Promise.all([
    listRepoConfigsDb(),
    listTaskBountiesDb(),
    listIntegrationHealthStatesDb()
  ])
  const enriched = await Promise.all(companies.map(async (company) => {
    const [memberships, wallets] = await Promise.all([
      listMemberships(company.id),
      listCompanyWallets(company.id)
    ])
    return {
      ...company,
      onboarding: deriveCompanyOnboardingState({
        company,
        memberships,
        repos: repos.filter((item) => item.companyId === company.id),
        wallets,
        tasks: tasks.filter((item) => item.companyId === company.id),
        integrationStates
      })
    }
  }))
  return NextResponse.json(pagination ? {
    items: enriched,
    pagination: { page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)) }
  } : enriched)
}

export async function POST(req: Request) {
  const auth = requireInternalUser(req)
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || 'create')

  if (action === 'create') {
    const validation = parseBody(createCompanySchema, body)
    if (!validation.success) return validation.response
    const name = String(body?.name || '').trim()
    if (!name) return NextResponse.json({ error: 'Missing company name' }, { status: 400 })

    const now = new Date().toISOString()
    const slugBase = slugify(body?.slug ? String(body.slug) : name)
    let slug = slugBase || `company-${uuidv4().slice(0, 8)}`
    let counter = 1
    while (await getCompanyBySlug(slug)) {
      slug = `${slugBase}-${counter++}`
    }

    const company: Company = {
      id: uuidv4(),
      slug,
      name,
      status: 'active',
      githubOrgLogin: body?.githubOrgLogin ? String(body.githubOrgLogin).trim() : undefined,
      githubOrgId: body?.githubOrgId ? String(body.githubOrgId).trim() : undefined,
      projectManagementTool: body?.projectManagementTool ? String(body.projectManagementTool).trim() as Company['projectManagementTool'] : undefined,
      projectManagementToolLabel: body?.projectManagementToolLabel ? String(body.projectManagementToolLabel).trim() : undefined,
      meegleWorkspaceId: body?.meegleWorkspaceId ? String(body.meegleWorkspaceId).trim() : undefined,
      meegleProjectKey: body?.meegleProjectKey ? String(body.meegleProjectKey).trim() : undefined,
      meegleViewUrl: body?.meegleViewUrl ? String(body.meegleViewUrl).trim() : undefined,
      meegleMcpToken: body?.meegleMcpToken ? String(body.meegleMcpToken).trim() : undefined,
      documentationTool: body?.documentationTool ? String(body.documentationTool).trim() as Company['documentationTool'] : undefined,
      documentationToolLabel: body?.documentationToolLabel ? String(body.documentationToolLabel).trim() : undefined,
      larkWebhookUrl: body?.larkWebhookUrl ? String(body.larkWebhookUrl).trim() : undefined,
      larkWebhookSecret: body?.larkWebhookSecret ? String(body.larkWebhookSecret).trim() : undefined,
      larkDefaultReceiveId: body?.larkDefaultReceiveId ? String(body.larkDefaultReceiveId).trim() : undefined,
      description: body?.description ? String(body.description) : '',
      websiteUrl: body?.websiteUrl ? String(body.websiteUrl) : undefined,
      contactEmail: body?.contactEmail ? String(body.contactEmail) : undefined,
      defaultRepoConfigId: body?.defaultRepoConfigId ? String(body.defaultRepoConfigId) : undefined,
      activeWalletId: undefined,
      createdByUserId: auth.session.userId,
      createdAt: now,
      updatedAt: now
    }

    const membership: CompanyMembership = {
      id: uuidv4(),
      companyId: company.id,
      userId: auth.session.userId,
      githubLogin: auth.session.githubLogin,
      githubUserId: auth.session.githubUserId,
      walletAddress: auth.session.walletAddress,
      role: 'company_owner',
      status: 'active',
      invitedByUserId: auth.session.userId,
      invitedAt: now,
      acceptedAt: now,
      createdAt: now,
      updatedAt: now
    }

    await insertCompany(company)
    await insertMembership(membership)
    await insertAuditLog({
      companyId: company.id,
      actorUserId: auth.session.userId,
      actorRole: getActorRoleLabel({ session: auth.session }),
      action: 'company.create',
      targetType: 'company',
      targetId: company.id,
      summary: `Created company ${company.name}`,
      metadata: { slug: company.slug },
      createdAt: now
    })

    const response = withSession(
      {
        ...auth.session,
        activeCompanyId: company.id,
        activeCompanyRole: 'company_owner'
      },
      NextResponse.json({ success: true, company, membership })
    )
    return response
  }

  if (action === 'update') {
    const validation = parseBody(updateCompanySchema, body)
    if (!validation.success) return validation.response
    const id = String(body?.id || '')
    const company = await getCompanyById(id)
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    const membership = await getMembership(id, auth.session.userId)
    const allowed = isPlatformAdmin(auth.session) || hasCompanyCapability(membership?.role, 'company.manage')
    if (!allowed) return NextResponse.json({ error: 'Not authorized to modify this company' }, { status: 403 })

    const updated = await updateCompanyFields(id, {
      name: body?.name ? String(body.name).trim() : undefined,
      githubOrgLogin: body?.githubOrgLogin !== undefined ? (body.githubOrgLogin ? String(body.githubOrgLogin).trim() : undefined) : undefined,
      githubOrgId: body?.githubOrgId !== undefined ? (body.githubOrgId ? String(body.githubOrgId).trim() : undefined) : undefined,
      projectManagementTool: body?.projectManagementTool !== undefined ? (body.projectManagementTool ? String(body.projectManagementTool).trim() as Company['projectManagementTool'] : undefined) : undefined,
      projectManagementToolLabel: body?.projectManagementToolLabel !== undefined ? (body.projectManagementToolLabel ? String(body.projectManagementToolLabel).trim() : undefined) : undefined,
      meegleWorkspaceId: body?.meegleWorkspaceId !== undefined ? (body.meegleWorkspaceId ? String(body.meegleWorkspaceId).trim() : undefined) : undefined,
      meegleProjectKey: body?.meegleProjectKey !== undefined ? (body.meegleProjectKey ? String(body.meegleProjectKey).trim() : undefined) : undefined,
      meegleViewUrl: body?.meegleViewUrl !== undefined ? (body.meegleViewUrl ? String(body.meegleViewUrl).trim() : undefined) : undefined,
      meegleMcpToken: body?.meegleMcpToken !== undefined ? (body.meegleMcpToken ? String(body.meegleMcpToken).trim() : undefined) : undefined,
      documentationTool: body?.documentationTool !== undefined ? (body.documentationTool ? String(body.documentationTool).trim() as Company['documentationTool'] : undefined) : undefined,
      documentationToolLabel: body?.documentationToolLabel !== undefined ? (body.documentationToolLabel ? String(body.documentationToolLabel).trim() : undefined) : undefined,
      larkWebhookUrl: body?.larkWebhookUrl !== undefined ? (body.larkWebhookUrl ? String(body.larkWebhookUrl).trim() : undefined) : undefined,
      larkWebhookSecret: body?.larkWebhookSecret !== undefined ? (body.larkWebhookSecret ? String(body.larkWebhookSecret).trim() : undefined) : undefined,
      larkDefaultReceiveId: body?.larkDefaultReceiveId !== undefined ? (body.larkDefaultReceiveId ? String(body.larkDefaultReceiveId).trim() : undefined) : undefined,
      description: body?.description !== undefined ? (body.description ? String(body.description) : '') : undefined,
      websiteUrl: body?.websiteUrl !== undefined ? (body.websiteUrl ? String(body.websiteUrl) : undefined) : undefined,
      contactEmail: body?.contactEmail !== undefined ? (body.contactEmail ? String(body.contactEmail) : undefined) : undefined,
      defaultRepoConfigId: body?.defaultRepoConfigId !== undefined ? (body.defaultRepoConfigId ? String(body.defaultRepoConfigId) : undefined) : undefined,
      status: body?.status
    })
    await insertAuditLog({
      companyId: company.id,
      actorUserId: auth.session.userId,
      actorRole: getActorRoleLabel({ session: auth.session, membershipRole: membership?.role }),
      action: 'company.update',
      targetType: 'company',
      targetId: company.id,
      summary: `Updated company ${company.name}`,
      metadata: body,
      createdAt: new Date().toISOString()
    })
    return NextResponse.json({ success: true, company: updated })
  }

  if (action === 'switchActiveCompany') {
    const validation = parseBody(switchActiveCompanySchema, body)
    if (!validation.success) return validation.response
    const id = String(body?.id || '')
    const company = await getCompanyById(id)
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    const membership = await getMembership(id, auth.session.userId)
    if (!membership && !isPlatformAdmin(auth.session)) {
      return NextResponse.json({ error: 'You are not a member of this company' }, { status: 403 })
    }
    return withSession(
      {
        ...auth.session,
        activeCompanyId: company.id,
        activeCompanyRole: membership?.role
      },
      NextResponse.json({ success: true, activeCompanyId: company.id, activeCompanyRole: membership?.role || null })
    )
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
