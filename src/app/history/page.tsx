'use client'

import { useState, useEffect } from 'react'
import * as store from '@/lib/store'
import { Batch, PLACEMENT_LABELS } from '@/types'
import Link from 'next/link'

export default function HistoryPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [filter, setFilter] = useState<'all' | 'printed' | 'complete'>('all')

  useEffect(() => {
    refreshData()
  }, [filter])

  const refreshData = () => {
    let allBatches = store.getBatches()
    if (filter === 'printed') allBatches = allBatches.filter(b => b.status === 'printed')
    else if (filter === 'complete') allBatches = allBatches.filter(b => b.status === 'complete')
    setBatches(allBatches.sort((a, b) => b.batch_number - a.batch_number))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Print History</h1>
        <div className="flex gap-2">
          {(['all', 'printed', 'complete'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === f
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {batches.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-gray-900 border border-gray-800 rounded-lg">
          <p className="text-lg mb-2">No batches found</p>
          <p className="text-sm">Completed batches will appear here for historical reference.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map(batch => {
            const batchItems = store.getBatchItems(batch.id)
            const invoiceNumbers = [...new Set(batchItems.map(bi => bi.job.invoice_number))]
            const statusColors: Record<string, string> = {
              building: 'bg-yellow-500/20 text-yellow-300',
              ready: 'bg-blue-500/20 text-blue-300',
              printing: 'bg-purple-500/20 text-purple-300',
              printed: 'bg-green-500/20 text-green-300',
              complete: 'bg-gray-500/20 text-gray-300',
            }

            return (
              <Link
                key={batch.id}
                href={`/batch/${batch.id}`}
                className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:bg-gray-800/70 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-lg">Batch #{batch.batch_number}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[batch.status]}`}>
                        {batch.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mt-1">
                      {batch.total_items} prints | Invoices: {invoiceNumbers.join(', ')}
                    </p>
                    {batchItems.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {batchItems.slice(0, 5).map(bi => (
                          <span key={bi.id} className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">
                            {PLACEMENT_LABELS[bi.job_item.placement]} ({bi.job_item.garment_age})
                          </span>
                        ))}
                        {batchItems.length > 5 && (
                          <span className="text-xs text-gray-500">+{batchItems.length - 5} more</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">
                      {new Date(batch.created_at).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      {new Date(batch.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
