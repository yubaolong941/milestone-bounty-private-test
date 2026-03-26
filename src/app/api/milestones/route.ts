import { NextResponse } from 'next/server'
import { updateProject, loadPayments, savePayments, getProjectById } from '@/lib/storage'
import { reviewMilestone } from '@/lib/ai'
import { transferWithWLFI } from '@/lib/wlfi'
import { getReports } from '@/lib/types'
import { v4 as uuidv4 } from 'uuid'

// POST /api/milestones { projectId, milestoneId, action?: 'aiReview' | 'approveAndPay', reviewer?: string }
export async function POST(req: Request) {
  const { projectId, milestoneId, action = 'aiReview', reviewer = 'Security Lead' } = await req.json()

  const project = getProjectById(projectId)
  if (!project) return NextResponse.json({ error: 'Bounty 项目不存在' }, { status: 404 })

  const reports = getReports(project)
  project.reports = reports
  const report = reports.find((m) => m.id === milestoneId)
  if (!report) return NextResponse.json({ error: '漏洞报告不存在' }, { status: 404 })

  if (report.status === 'paid') {
    return NextResponse.json({ error: '该漏洞单已支付，不能重复触发' }, { status: 400 })
  }

  if (action === 'aiReview') {
    report.status = 'reviewing'
    report.completedAt = new Date().toISOString()
    updateProject(project)

    const { approved, summary } = await reviewMilestone(project, report)
    report.aiReviewSummary = summary

    if (!approved) {
      report.status = 'rejected'
      updateProject(project)
      return NextResponse.json({ success: false, summary, approved: false })
    }

    report.status = 'awaiting_manual_review'
    updateProject(project)
    return NextResponse.json({
      success: true,
      approved: true,
      awaitingManualReview: true,
      summary
    })
  }

  if (report.status !== 'awaiting_manual_review' && report.status !== 'approved') {
    return NextResponse.json({ error: '当前状态不能执行人工复核支付' }, { status: 400 })
  }

  report.status = 'approved'
  report.reviewer = reviewer
  report.reviewedAt = new Date().toISOString()
  report.manualReviewSummary = `人工复核通过（${reviewer}）`
  updateProject(project)

  const memo = `[${project.name}] ${report.name} 漏洞赏金`
  const transferResult = await transferWithWLFI(
    report.assigneeWallet,
    report.rewardAmount,
    memo
  )

  if (!transferResult.success) {
    report.status = 'awaiting_manual_review'
    updateProject(project)
    return NextResponse.json({ success: false, error: transferResult.error, summary: report.aiReviewSummary || '' })
  }

  report.status = 'paid'
  report.txHash = transferResult.txHash
  report.paidAt = new Date().toISOString()
  project.spentAmount += report.rewardAmount
  updateProject(project)

  const payments = loadPayments()
  payments.push({
    id: uuidv4(),
    projectId: project.id,
    projectName: project.name,
    reportId: report.id,
    reportTitle: report.name,
    severity: report.severity,
    milestoneId: report.id,
    milestoneName: report.name,
    amount: report.rewardAmount,
    toAddress: report.assigneeWallet,
    toName: report.assigneeName,
    txHash: transferResult.txHash!,
    memo,
    timestamp: new Date().toISOString()
  })
  savePayments(payments)

  return NextResponse.json({
    success: true,
    approved: true,
    summary: report.aiReviewSummary,
    txHash: transferResult.txHash,
    amount: report.rewardAmount
  })
}
