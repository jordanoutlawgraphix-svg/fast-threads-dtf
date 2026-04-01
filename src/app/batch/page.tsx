'use client'

import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import * as store from '@/lib/store'
import { layoutGangSheetOptimized, PrintItem } from '@/lib/gang-sheet-engine'
import { JobItem, JobSubmission, Batch, PLACEMENT_LABELS, DEFAULT_GANG_SHEET_CONFIG } from '@/types'
import Link from 'next/link'

type UnbatchedItem = JobItem & { job: JobSubmission }

export default function BatchPage() {
  const [unbatchedItems, setUnbatchedItems] = useState<UnbatchedItem[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [batches, setBatches] = useState<Batch[]>([])
  const [previewLayout, setPreviewLayout] = useState<ReturnType<typeof layoutGangSheetOptimized> | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<string | null>(null)

  useEffect(() => { refreshData() }, [])

  const refreshData = async () => {
    setLoading(true)
    const [items, allBatches] = await Promise.all([store.getUnbatchedItems(), store.getBatches()])
    setUnbatchedItems(items)
    setBatches(allBatches)
    setLoading(false)
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

  const [previewImageUrls, setPreviewImageUrls] = useState<Record<string, string>>({})

  const previewGangSheet = () => {
    const printItems: PrintItem[] = unbatchedItems
      .filter(i => selectedItems.has(i.id))
      .map(i => ({
        id: i.id,
        width_inches: Number(i.target_width_inches),
        height_inches: Number(i.target_height_inches),
        quantity: i.quantity,
        label: `#${i.job.invoice_number} | ${PLACEMENT_LABELS[i.placement]} | ${i.garment_age}`,
        invoice_number: i.job.invoice_number,
        thumbnail_url: i.file_path ? store.getFileUrl(i.file_path) : undefined,
      }))
    if (printItems.length === 0) return

    // Build image URL lookup for preview    const imageMap: Record<string, string> = {}
    for (const p of printItems) {
      if (p.thumbnail_url) imageMap[p.id] = p.thumbnail_url
    }
    setPreviewImageUrls(imageMap)

    const nextBatchNum = batches.length > 0 ? Math.max(...batches.map(b => b.batch_number)) + 1 : 1
    const layout = layoutGangSheetOptimized(printItems, nextBatchNum, DEFAULT_GANG_SHEET_CONFIG)
    setPreviewLayout(layout)
  }

  const createBatch = async () => {
    if (!previewLayout) return
    setCreating(true)
    try {
      const batchId = uuidv4()
      const batch = await store.createBatch({
        id: batchId,
        status: 'ready',
        total_items: previewLayout.total_items,
        gang_sheet_url: null,
        summary_pdf_url: null,
        notes: null,
      })
      if (!batch) throw new Error('Failed to create batch')

      // Create batch items
      const batchItemsToInsert = previewLayout.placed_items.map(placed => ({
        id: uuidv4(),
        batch_id: batch.id,        job_item_id: placed.item_id,
        x_position: placed.x,
        y_position: placed.y,
        print_width: placed.width,
        print_height: placed.height,
      }))
      await store.createBatchItems(batchItemsToInsert)

      // Mark jobs as batched
      const selectedJobItems = unbatchedItems.filter(i => selectedItems.has(i.id))
      const jobIds = new Set(selectedJobItems.map(i => i.job_id))
      await Promise.all(Array.from(jobIds).map(jid => store.updateJobStatus(jid, 'batched')))

      setSelectedItems(new Set())
      setPreviewLayout(null)
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
              <button onClick={previewGangSheet} disabled={selectedItems.size === 0}
                className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50">
                Preview Gang Sheet ({selectedItems.size})
              </button>
            </div>
          </div>
          {loading ? (
            <div className="text-center py-8 text-gray-500 bg-gray-900 border border-gray-800 rounded-lg">Loading...</div>
          ) : unbatchedItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500 bg-gray-900 border border-gray-800 rounded-lg">
              <p>No unbatched items. Submit jobs to get started.</p>            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {unbatchedItems.map(item => {
                const thumbUrl = item.file_path ? store.getFileUrl(item.file_path) : null
                return (
                  <label key={item.id} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedItems.has(item.id) ? 'bg-orange-900/20 border border-orange-800/50' : 'bg-gray-900 border border-gray-800 hover:bg-gray-800/70'
                  }`}>
                    <input type="checkbox" checked={selectedItems.has(item.id)} onChange={() => toggleItem(item.id)} className="w-4 h-4 accent-orange-500" />
                    {thumbUrl && <img src={thumbUrl} alt="" className="w-10 h-10 object-contain bg-gray-700 rounded" />}
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

        {/* Right: Preview or Existing Batches */}
        <div>
          {previewLayout ? (
            <div>
              <h2 className="font-semibold mb-3">Gang Sheet Preview — Batch #{previewLayout.batch_number}</h2>
              <GangSheetPreview layout={previewLayout} imageUrls={previewImageUrls} />              <div className="mt-4 flex gap-3">
                <button onClick={createBatch} disabled={creating}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50">
                  {creating ? 'Creating...' : 'Create Batch'}
                </button>
                <button onClick={() => setPreviewLayout(null)} className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm">Cancel</button>
              </div>
            </div>
          ) : (
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
                            <span className="text-sm text-gray-400">{batch.total_items} items</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[batch.status]}`}>{batch.status.toUpperCase()}</span>
                            <span className="text-xs text-gray-500">{new Date(batch.created_at).toLocaleDateString()}</span>                          </div>
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
          )}
        </div>
      </div>
    </div>
  )
}

function GangSheetPreview({ layout, imageUrls = {} }: { layout: ReturnType<typeof layoutGangSheetOptimized>; imageUrls?: Record<string, string> }) {
  const scale = 20
  const svgWidth = layout.sheet_width * scale  const svgHeight = layout.sheet_height * scale
  const checkerSize = 4

  return (
    <div className="bg-gray-800 rounded-lg p-4 overflow-auto">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400">
          {layout.sheet_width}&quot; x {layout.sheet_height}&quot; | {layout.total_items} prints | {layout.utilization_percent}% utilization
        </p>
      </div>
      <div className="overflow-auto border border-gray-700 rounded" style={{ maxHeight: '500px' }}>
        <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
          {/* Checkered background pattern so white artwork is visible */}
          <defs>
            <pattern id="checker" width={checkerSize * 2} height={checkerSize * 2} patternUnits="userSpaceOnUse">
              <rect width={checkerSize * 2} height={checkerSize * 2} fill="#f0f0f0" />
              <rect width={checkerSize} height={checkerSize} fill="#ffffff" />
              <rect x={checkerSize} y={checkerSize} width={checkerSize} height={checkerSize} fill="#ffffff" />
            </pattern>
          </defs>
          <rect width={svgWidth} height={svgHeight} fill="url(#checker)" />
          <rect x={0} y={0} width={svgWidth} height={10 * scale / 20} fill="#f97316" />
          <text x={svgWidth / 2} y={8} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">START BATCH #{layout.batch_number}</text>
          {layout.placed_items.map((item, i) => {
            const x = item.x * scale
            const y = item.y * scale
            const w = item.width * scale
            const h = item.height * scale
            const imgUrl = imageUrls[item.item_id]
            return (
              <g key={i}>                {imgUrl ? (
                  <image href={imgUrl} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid meet" />
                ) : (
                  <rect x={x} y={y} width={w} height={h} fill="#e5e7eb" rx={1} />
                )}
                <rect x={x} y={y} width={w} height={h} fill="none" stroke="#9ca3af" strokeWidth={0.5} />
                <text x={x + w / 2} y={y + h - 2} textAnchor="middle" fill="#374151" fontSize={Math.min(5, w / 12)} fontWeight="bold"
                  style={{ textShadow: '0 0 2px white, 0 0 2px white' }}>
                  {item.invoice_number}
                </text>
              </g>
            )
          })}
          <rect x={0} y={svgHeight - 10} width={svgWidth} height={10} fill="#f97316" />
          <text x={svgWidth / 2} y={svgHeight - 3} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">END BATCH #{layout.batch_number}</text>
        </svg>
      </div>
    </div>
  )
}
