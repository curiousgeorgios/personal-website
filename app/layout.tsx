import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import MetaPixel from "../components/MetaPixel"
import { PostHogProvider } from "../components/PostHogProvider"

const inter = Inter({ subsets: ["latin"], weight: ["100", "200", "300", "400", "500"] })

export const metadata: Metadata = {
  title: "GV | Personal Space",
  description: "A minimalist personal website",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <PostHogProvider>
          <MetaPixel />
          {children}
        </PostHogProvider>
      </body>
    </html>
  )
}