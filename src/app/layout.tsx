import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BountyPay - AI 漏洞赏金自动支付',
  description: '由 AI 驱动的 Bug Bounty 运营系统，漏洞复核通过后自动通过 WLFI 发放赏金'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-950 text-gray-100 min-h-screen">{children}</body>
    </html>
  )
}
