import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ToastContainer } from '@/components/Toast'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600', '700']
})

export const metadata: Metadata = {
  title: {
    default: 'tomo | AI Delivery & Audit Payment Platform',
    template: '%s | tomo'
  },
  description: 'tomo connects task publishing, claiming, delivery, review, payment, and audit into one demonstrable, operable, and auditable product pipeline.',
  applicationName: 'tomo'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={`app-shell min-h-screen ${inter.className}`}>{children}<ToastContainer /></body>
    </html>
  )
}
