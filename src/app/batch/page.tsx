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

  useEffect(() => {
    refreshData()
  }, [])

  const refreshData = () => {
    setUnbatchedItems(store.getUnbatchedItems())
    setBatches(store.getBatches().sort((a, b) => b.batch_number - a.batch_number))
  }

  const toggleItem = (itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const selectAll = () => {
    if (selectedItems.size === unbatchedItems.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(unbatchedItems.map(i => i.id)))
    }
  }

  const previewGangSheet = () => {
    const printItems: PrintItem[] = unbatchedItems
      .filter(i => selectedItems.has(i.id))
      .map(i => ({
        id: i.id,
        width_inches: i.target_width_inches,
        height_inches: i.target_height_inches,
        quantity: i.quantity,
        label: `#${i.job.invoice_number} | ${PLACEMENT_LABELS[i.placement]} | ${i.garment_age}`,
        invoice_number: i.job.invoice_number,
        thumbnail_url: store.getFileUrl(i.file_url) || undefined,
      }))

    if (printItems.length === 0) return

    const nextBatchNum = batches.length > 0 ? Math.max(...batches.map(b => b.batch_number)) + 1 : 1
    const layout = layoutGangSheetOptimized(printItems, nextBatchNum, DEFAULT_GANG_SHEET_CONFIG)
    setPreviewLayout(layout)
  }

  const createBatch = () => {
    if (!previewLayout) return

    const batchId = uuidv4()
    const batch = store.createBatch({
      id: batchId,
      created_at: new Date().toISOString(),
      status: 'ready',
      total_items: previewLayout.total_items,
      gang_sheet_url: null,
      summary_pdf_url: null,
      notes: null,
    })

    // Create batch items
    for (const placed of previewLayout.placed_items) {
      store.createBatchItem({
        id: uuidv4(),
        batch_id: batch.id,
        job_item_id: placed.item_id,
        x_position: placed.x,
        y_position: placed.y,
        print_width: placed.width,
        print_height: placed.height,
      })
    }

    // Mark selected jobs as batched
    const selectedJobItems = unbatchedItems.filter(i => selectedItems.has(i.id))
    const jobIds = new Set(selectedJobItems.map(i => i.job_id))
    jobIds.forEach(jid => store.updateJobStatus(jid, 'batched'))

    setSelectedItems(new Set())
    setPreviewLayout(null)
    refreshData()
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
              <button
                onClick={previewGangSheet}
                disabled={selectedItems.size === 0}
                className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
              >
                Preview Gang Sheet ({selectedItems.size})
              </button>
            </div>
          </div>

          {unbatchedItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500 bg-gray-900 border border-gray-800 rounded-lg">
              <p>No unbatched items. Submit jobs to get started.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {unbatchedItems.map(item => {
                const thumbUrl = store.getFileUrl(item.file_url)
                return (
                  <label
                    key={item.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedItems.has(item.id)
                        ? 'bg-orange-900/20 border border-orange-800/50'
                        : 'bg-gray-900 border border-gray-800 hover:bg-gray-800/70'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      className="w-4 h-4 accent-orange-500"
                    />
                    {thumbUrl && (
                      <img src={thumbUrl} alt="" className="w-10 h-10 object-contain bg-gray-700 rounded" />
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

        {/* Right: Gang Sheet Preview OR Existing Batches */}
        <div>
          {previewLayout ? (
            <div>
              <h2 className="font-semibold mb-3">Gang Sheet Preview — Batch #{previewLayout.batch_number}</h2>
              <GangSheetPreview layout={previewLayout} />
              <div className="mt-4 flex gap-3">
                <button
                  onClick={createBatch}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  Create Batch
                </button>
                <button
                  onClick={() => setPreviewLayout(null)}
                  className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm"
                >
                  Cancel
                </button>
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
                  {batches.map(batch => (
                    <Link
                      key={batch.id}
                      href={`/batch/${batch.id}`}
                      className="flex items-center justify-between p-4 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800/70 transition-colors"
                    >
                      <div>
                        <span className="font-semibold">Batch #{batch.batch_number}</span>
                        <span className="text-gray-500 mx-2">|</span>
                        <span className="text-sm text-gray-400">{batch.total_items} items</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[batch.status]}`}>
                          {batch.status.toUpperCase()}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(batch.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Gang Sheet Visual Preview ----

function GangSheetPreview({ layout }: { layout: ReturnType<typeof layoutGangSheetOptimized> }) {
  const scale = 20 // pixels per inch for preview
  const svgWidth = layout.sheet_width * scale
  const svgHeight = layout.sheet_height * scale

  return (
    <div className="bg-gray-800 rounded-lg p-4 overflow-auto">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400">
          {layout.sheet_width}&quot; x {layout.sheet_height}&quot; | {layout.total_items} prints | {layout.utilization_percent}% utilization
        </p>
      </div>
      <div className="overflow-auto border border-gray-700 rounded" style={{ maxHeight: '500px' }}>
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="bg-white"
        >
          {/* Batch start label */}
          <rect x={0} y={0} width={svgWidth} height={10 * scale / 20} fill="#f97316" />
          <text x={svgWidth / 2} y={8} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">
            START BATCH #{layout.batch_number}
          </text>

          {/* Placed items */}
          {layout.placed_items.map((item, i) => (
            <g key={i}>
              <rect
                x={item.x * scale}
                y={item.y * scale}
                width={item.width * scale}
                height={item.height * scale}
                fill="#e5e7eb"
                stroke="#9ca3af"
                strokeWidth={0.5}
                rx={2}
              />
              <text
                x={item.x * scale + (item.width * scale) / 2}
                y={item.y * scale + (item.height * scale) / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#374151"
                fontSize={Math.min(6, item.width * scale / 10)}
              >
                {item.invoice_number}
              </text>
            </g>
          ))}

          {/* Batch end label */}
          <rect x={0} y={svgHeight - 10} width={svgWidth} height={10} fill="#f97316" />
          <text x={svgWidth / 2} y={svgHeight - 3} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">
            END BATCH #{layout.batch_number}
          </text>
        </svg>
      </div>
    </div>
  )
}
