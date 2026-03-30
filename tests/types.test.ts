import { describe, expect, it } from 'vitest'
import { getReports, type Project } from '@/lib/types'

describe('getReports', () => {
  it('returns reports when present', () => {
    const project: Project = {
      id: 'project-1',
      name: 'Demo Project',
      description: 'Demo',
      totalBudget: 1000,
      spentAmount: 100,
      createdAt: '2026-03-27T00:00:00.000Z',
      reports: [
        {
          id: 'report-1',
          name: 'Critical finding',
          description: 'desc',
          completionCriteria: 'criteria',
          rewardAmount: 100,
          assigneeName: 'alice',
          assigneeWallet: '0xabc',
          deadline: '2026-04-01',
          status: 'pending'
        }
      ]
    }

    expect(getReports(project)).toHaveLength(1)
    expect(getReports(project)[0]?.id).toBe('report-1')
  })

  it('falls back to legacy milestones snapshots', () => {
    const project = {
      id: 'project-legacy',
      name: 'Legacy Project',
      description: 'Legacy',
      totalBudget: 1000,
      spentAmount: 0,
      createdAt: '2026-03-27T00:00:00.000Z',
      milestones: [
        {
          id: 'milestone-1',
          name: 'Legacy report',
          description: 'desc',
          completionCriteria: 'criteria',
          rewardAmount: 200,
          assigneeName: 'bob',
          assigneeWallet: '0xdef',
          deadline: '2026-04-02',
          status: 'approved'
        }
      ]
    } as Project

    expect(getReports(project)).toHaveLength(1)
    expect(getReports(project)[0]?.id).toBe('milestone-1')
  })
})
