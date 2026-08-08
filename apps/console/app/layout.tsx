import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Venue - the compliant secondary market',
  description: 'An order book where eligibility shapes the market instead of gating the transfer.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
