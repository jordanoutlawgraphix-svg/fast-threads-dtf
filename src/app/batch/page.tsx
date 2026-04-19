'use client'

import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import * as store from '@/lib/store'
import { JobItem, JobSubmission, Batch, PLACEMENT_LABELS } from '@/types'
import Link from 'next/link'
import { renderPdfThumbnailFromUrl } from '@/lib/pdf-utils'

type UnbatchedItem = JobItem & { job: JobSubmission }

export default function BatchPage() {
  const [unbatchedItems, setUnbatchedItems] = useState<UnbatchedItem[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})

  useEffect(() => { refreshData() }, [])

  const refreshData = async () => {
    setLoading(true)
    const [items, allBatches] = await Promise.all([store.getUnbatchedItems(), store.getBatches()])
    setUnbatchedItems(items)
    setBatches(allBatches)
    setLoading(false)

    // Generate thumbnails for PDF files in background
    for (const item of items) {
      if (item.file_path && !thumbnails[item.id]) {
        const url = store.getFileUrl(item.file_path)
        renderPdfThumbnailFromUrl(url, 80).then(dataUrl => {
          setThumbnails(prev => ({ ...prev, [item.id]: dataUrl }))
        }).catch(() => {})
      }
    }
  }

  const toggleItem = (itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId)
      return next
    })
  }

  const selectAll = () => {
    if (selectedItems.size === unbatchedItems.length) setSelectedItems(new Set())
    else setSelectedItems(new Set(unbatchedItems.map(i => i.id)))
  }

  const createBatch = async () => {
    const selected = unbatchedItems.filter(i => selectedItems.has(i.id))
    if (selected.length === 0) return
    setCreating(true)
    try {
      const batchId = uuidv4()
      const totalPrints = selected.reduce((sum, item) => sum + item.quantity, 0)
      const batch = await store.createBatch({
        id: batchId,
        status: 'ready',
        total_items: totalPrints,
        gang_sheet_url: null,
        summary_pdf_url: null,
        notes: null,
      })
      if (!batch) throw new Error('Failed to create batch')

      // Create batch items — one per item, position fields are unused
      // (NeoStampa handles layout natively)
      const batchItemsToInsert = selected.map(item => ({
        id: uuidv4(),
        batch_id: batch.id,
        job_item_id: item.id,
        x_position: 0,
        y_position: 0,
        print_width: Number(item.target_width_inches),
        print_height: Number(item.target_height_inches),
      }))
      await store.createBatchItems(batchItemsToInsert)

      // Mark jobs as batched
      const jobIds = new Set(selected.map(i => i.job_id))
      await Promise.all(Array.from(jobIds).map(jid => store.updateJobStatus(jid, 'batched')))

      setSelectedItems(new Set())
      await refreshData()
    } catch (err) {
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteBatch = async (batchId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    await store.deleteBatch(batchId)
    setConfirmDeleteBatch(null)
    await refreshData()
  }

  const statusColors: Record<string, string> = {
    building: 'bg-yellow-500/20 text-yellow-300',
    ready: 'bg-blue-500/20 text-blue-300',
    printing: 'bg-purple-500/20 text-purple-300',
    printed: 'bg-green-500/20 text-green-300',
    complete: 'bg-gray-500/20 text-gray-300',
  }

  // Summary of selected items
  const selectedCount = selectedItems.size
  const selectedPrints = unbatchedItems
    .filter(i => selectedItems.has(i.id))
    .reduce((sum, i) => sum + i.quantity, 0)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Batch Management</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Unbatched Items */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Unbatched Items ({unbatchedItems.length})</h2>
            <div className="flex gap-2">
              <button onClick={selectAll} className="px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 hover:bg-gray-700">
                {selectedItems.size === unbatchedItems.length ? 'Deselect All' : 'Select All'}
              </button>
              <button onClick={createBatch} disabled={selectedCount === 0 || creating}
                className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50">
                {creating ? 'Creating...' : `Create Batch (${selectedCount} items, ${selectedPrints} prints)`}
              </button>
            </div>
          </div>
          {loading ? (
            <div className="text-center py-8 text-gray-500 bg-gray-900 border border-gray-800 rounded-lg">Loading...</div>
          ) : unbatchedItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500 bg-gray-900 border border-gray-800 rounded-lg">
              <p>No unbatched items. Submit jobs to get started.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {unbatchedItems.map(item => {
                const thumbUrl = thumbnails[item.id] || null
                return (
                  <label key={item.id} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedItems.has(item.id) ? 'bg-orange-900/20 border border-orange-800/50' : 'bg-gray-900 border border-gray-800 hover:bg-gray-800/70'
                  }`}>
                    <input type="checkbox" checked={selectedItems.has(item.id)} onChange={() => toggleItem(item.id)} className="w-4 h-4 accent-orange-500" />
                    {thumbUrl ? (
                      <img src={thumbUrl} alt="" className="w-10 h-10 object-contain bg-gray-700 rounded" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-700 rounded flex items-center justify-center">
                        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">#{item.job.invoice_number}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {PLACEMENT_LABELS[item.placement]} | {item.garment_age} | {item.target_width_inches}&quot;x{item.target_height_inches}&quot; | x{item.quantity}
                      </p>
                    </div>
                    <span className="text-xs text-gray-500">{item.job.location_code}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Existing Batches */}
        <div>
          <h2 className="font-semibold mb-3">Recent Batches</h2>
          {batches.length === 0 ? (
            <div className="text-center py-8 text-gray-500 bg-gray-900 border border-gray-800 rounded-lg">
              <p>No batches yet. Select items and create your first batch.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {batches.map(batch => {
                const canDelete = ['ready', 'building'].includes(batch.status)
                return (
                  <div key={batch.id} className="flex items-center gap-2">
                    <Link href={`/batch/${batch.id}`}
                      className="flex-1 flex items-center justify-between p-4 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800/70 transition-colors">
                      <div>
                        <span className="font-semibold">Batch #{batch.batch_number}</span>
                        <span className="text-gray-500 mx-2">|</span>
                        <span className="text-sm text-gray-400">{batch.total_items} prints</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[batch.status]}`}>{batch.status.toUpperCase()}</span>
                        <span className="text-xs text-gray-500">{new Date(batch.created_at).toLocaleDateString()}</span>
                      </div>
                    </Link>
                    {canDelete && (
                      confirmDeleteBatch === batch.id ? (
                        <div className="flex flex-col gap-1">
                          <button onClick={(e) => handleDeleteBatch(batch.id, e)} className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700">Delete</button>
                          <button onClick={() => setConfirmDeleteBatch(null)} className="px-3 py-1.5 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDeleteBatch(batch.id)}
                          className="px-2 py-2 text-red-400/60 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors" title="Delete batch">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
