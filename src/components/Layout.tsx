import type React from 'react'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] w-full flex-col items-center overflow-x-hidden pb-4 sm:h-screen">
      {children}
    </main>
  )
}
