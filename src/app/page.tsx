'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import * as store from '@/lib/store'

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalJobs: 0,
    pendingJobs: 0,
    totalBatches: 0,
    readyBatches: 0,
    printedBatches: 0,
    totalItemsPrinted: 0,
  })

  useEffect(() => {
    setStats(store.getStats())
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">DTF Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Total Jobs" value={stats.totalJobs} />
        <StatCard label="Pending" value={stats.pendingJobs} color="yellow" />
        <StatCard label="Total Batches" value={stats.totalBatches} />
        <StatCard label="Ready to Print" value={stats.readyBatches} color="blue" />
        <StatCard label="Printed" value={stats.printedBatches} color="green" />
        <StatCard label="Items Printed" value={stats.totalItemsPrinted} color="green" />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <QuickAction
          href="/submit"
          title="Submit New Job"
          description="Drop in files, set invoice number, placement, and quantities"
          color="orange"
        />
        <QuickAction
          href="/queue"
          title="View Print Queue"
          description="See all submitted jobs waiting to be batched and printed"
          color="blue"
        />
        <QuickAction
          href="/batch"
          title="Manage Batches"
          description="Create gang sheets, print summaries, and track batches"
          color="green"
        />
      </div>

      {/* Info banner */}
      <div className="mt-8 bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p className="text-sm text-gray-400">
          <strong className="text-orange-400">How it works:</strong> Staff at any location submit DTF jobs with files, invoice numbers, and placement details.
          The system validates sizes, auto-resizes for youth garments, and organizes everything into
          gang sheet batches with tracking numbers. The DTF operator can print summary sheets and
          match them to cut pieces.
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value, color = 'gray' }: { label: string; value: number; color?: string }) {
  const colorClasses: Record<string, string> = {
    gray: 'bg-gray-900 border-gray-800',
    yellow: 'bg-yellow-900/20 border-yellow-800/50',
    blue: 'bg-blue-900/20 border-blue-800/50',
    green: 'bg-green-900/20 border-green-800/50',
    orange: 'bg-orange-900/20 border-orange-800/50',
  }

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
    </div>
  )
}

function QuickAction({ href, title, description, color }: { href: string; title: string; description: string; color: string }) {
  const colorClasses: Record<string, string> = {
    orange: 'border-orange-800/50 hover:border-orange-600/50 hover:bg-orange-900/10',
    blue: 'border-blue-800/50 hover:border-blue-600/50 hover:bg-blue-900/10',
    green: 'border-green-800/50 hover:border-green-600/50 hover:bg-green-900/10',
  }

  return (
    <Link
      href={href}
      className={`block p-6 rounded-lg border transition-all ${colorClasses[color]}`}
    >
      <h3 className="font-semibold text-lg mb-2">{title}</h3>
      <p className="text-sm text-gray-400">{description}</p>
    </Link>
  )
}
