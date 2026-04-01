'use client'

import { useState, useEffect, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import * as store from '@/lib/store'
import { Batch, BatchItem, JobItem, JobSubmission, PLACEMENT_LABELS, DEFAULT_GANG_SHEET_CONFIG } from '@/types'
import { layoutGangSheetOptimized, PrintItem } from '@/lib/gang-sheet-engine'
import { downloadGangSheetPNG } from '@/lib/gang-sheet-export'
import { downloadBatchSummaryPDF } from '@/lib/summary-pdf'

type EnrichedBatchItem = BatchItem & { job_item: JobItem; job: JobSubmission }

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [batchItems, setBatchItems] = useState<EnrichedBatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [dissolving, setDissolving] = useState(false)
  const router = useRouter()

  useEffect(() => {
    loadData()
  }, [id])

  const loadData = async () => {
    setLoading(true)
    const [b, items] = await Promise.all([store.getBatch(id), store.getBatchItems(id)])
    setBatch(b)
    setBatchItems(items)
    setLoading(false)
  }

  const markAsPrinting = async () => {
    await store.updateBatchStatus(id, 'printing')
    setBatch(prev => prev ? { ...prev, status: 'printing' } : null)
  }

  const markAsPrinted = async () => {
    await store.updateBatchStatus(id, 'printed')
    setBatch(prev => prev ? { ...prev, status: 'printed' } : null)
  }

  const handleDissolveBatch = async () => {
    if (!batch) return
    if (!confirm(`Un-batch Batch #${batch.batch_number}? All items will return to the unbatched queue.`)) return
    setDissolving(true)
    try {
      const ok = await store.dissolveBatch(id)
      if (ok) {
        router.push('/batch')
      }
    } catch (err) {
      console.error('Dissolve failed:', err)
    } finally {
      setDissolving(false)
    }
  }

  const markAsComplete = async () => {
    await store.updateBatchStatus(id, 'complete')
    setBatch(prev => prev ? { ...prev, status: 'complete' } : null)
    const jobIds = new Set(batchItems.map(bi => bi.job.id))
    await Promise.all(Array.from(jobIds).map(jid => store.updateJobStatus(jid, 'complete')))
  }

  const handleDownloadGangSheet = async () => {
    if (!batch) return
    setExporting(true)
    try {
      // Rebuild the layout from batch items
      const printItems: PrintItem[] = []
      const imageUrls: Record<string, string> = {}
      const seen = new Set<string>()

      for (const bi of batchItems) {
        if (seen.has(bi.job_item_id)) continue
        seen.add(bi.job_item_id)

        const count = batchItems.filter(x => x.job_item_id === bi.job_item_id).length
        const filePath = bi.job_item.file_path
        if (filePath) {
          imageUrls[bi.job_item_id] = store.getFileUrl(filePath)
        }

        printItems.push({
          id: bi.job_item_id,
          width_inches: Number(bi.job_item.target_width_inches),
          height_inches: Number(bi.job_item.target_height_inches),
          quantity: count,
          label: `#${bi.job.invoice_number} | ${PLACEMENT_LABELS[bi.job_item.placement]} | ${bi.job_item.garment_age}`,
          invoice_number: bi.job.invoice_number,
        })
      }

      const layout = layoutGangSheetOptimized(printItems, batch.batch_number, DEFAULT_GANG_SHEET_CONFIG)
      await downloadGangSheetPNG(layout, { renderImages: true, imageUrls })
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  const handleDownloadPDF = () => {
    if (!batch) return
    downloadBatchSummaryPDF(batch, batchItems)
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading batch...</div>
  }

  if (!batch) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>Batch not found.</p>
      </div>
    )
  }

  // Group items by invoice number for the summary
  const groupedByInvoice: Record<string, EnrichedBatchItem[]> = {}
  for (const item of batchItems) {
    const inv = item.job.invoice_number
    if (!groupedByInvoice[inv]) groupedByInvoice[inv] = []
    groupedByInvoice[inv].push(item)
  }

  return (
    <div>
      {/* Screen-only header */}
      <div className="no-print">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Batch #{batch.batch_number}</h1>
            <p className="text-sm text-gray-400">
              Created {new Date(batch.created_at).toLocaleString()} | {batch.total_items} total prints
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleDownloadGangSheet} disabled={exporting}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-medium disabled:opacity-50">
              {exporting ? 'Exporting...' : 'Download Gang Sheet PNG'}
            </button>
            <button onClick={handleDownloadPDF}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 text-sm">
              Download Summary PDF
            </button>
            <button onClick={() => window.print()}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
              Print Summary
            </button>
            {batch.status !== 'complete' && (
              <button onClick={handleDissolveBatch} disabled={dissolving}
                className="px-4 py-2 bg-red-800 text-red-200 rounded-lg hover:bg-red-700 text-sm border border-red-700 disabled:opacity-50">
                {dissolving ? 'Un-batching...' : 'Un-batch'}
              </button>
            )}
            {batch.status === 'ready' && (
              <button onClick={markAsPrinting} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm">
                Start Printing
              </button>
            )}
            {batch.status === 'printing' && (
              <button onClick={markAsPrinted} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
                Mark Printed
              </button>
            )}
            {batch.status === 'printed' && (
              <button onClick={markAsComplete} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                Mark Complete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Printable Summary Sheet */}
      <div className="bg-white text-black rounded-lg p-6 print:rounded-none print:p-0">
        {/* Header */}
        <div className="border-b-2 border-black pb-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Fast Threads DTF — Batch Summary</h2>
              <p className="text-sm text-gray-600">
                Batch #{batch.batch_number} | {new Date(batch.created_at).toLocaleDateString()} | {batch.total_items} total prints
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black">#{batch.batch_number}</p>
              <p className="text-xs text-gray-500 uppercase">Batch Number</p>
            </div>
          </div>
        </div>

        {/* Items grouped by invoice */}
        <div className="space-y-6">
          {Object.entries(groupedByInvoice).map(([invoiceNum, items]) => {
            // Deduplicate items for this invoice
            const seen = new Map<string, { item: EnrichedBatchItem; count: number }>()
            for (const bi of items) {
              if (!seen.has(bi.job_item_id)) {
                seen.set(bi.job_item_id, { item: bi, count: 1 })
              } else {
                seen.get(bi.job_item_id)!.count++
              }
            }

            return (
              <div key={invoiceNum} className="border border-gray-300 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-lg">Invoice: {invoiceNum}</h3>
                  <span className="text-sm text-gray-500">
                    {items[0].job.location_code} | {items[0].job.submitter_name}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="py-1 text-left w-20">Preview</th>
                      <th className="py-1 text-left">File</th>
                      <th className="py-1 text-left">Placement</th>
                      <th className="py-1 text-left">Size</th>
                      <th className="py-1 text-center">Adult Qty</th>
                      <th className="py-1 text-center">Youth Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(seen.values()).map(({ item, count }) => {
                      const thumbUrl = item.job_item.file_path ? store.getFileUrl(item.job_item.file_path) : null
                      return (
                        <tr key={item.job_item_id} className="border-b border-gray-200">
                          <td className="py-2">
                            {thumbUrl && (
                              <img src={thumbUrl} alt="" className="w-14 h-14 object-contain border border-gray-200" />
                            )}
                          </td>
                          <td className="py-2 text-xs">{item.job_item.original_filename}</td>
                          <td className="py-2">
                            {PLACEMENT_LABELS[item.job_item.placement]}
                            {item.job_item.custom_placement_name ? ` (${item.job_item.custom_placement_name})` : ''}
                          </td>
                          <td className="py-2">
                            {item.job_item.target_width_inches}&quot; x {item.job_item.target_height_inches}&quot;
                          </td>
                          <td className="py-2 text-center font-bold">
                            {item.job_item.garment_age === 'adult' ? count : '-'}
                          </td>
                          <td className="py-2 text-center font-bold">
                            {item.job_item.garment_age === 'youth' ? count : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t-2 border-black text-center">
          <p className="text-sm font-bold">
            BATCH #{batch.batch_number} — {batch.total_items} TOTAL PRINTS — Match this sheet to your gang sheet output
          </p>
          <p className="text-xs text-gray-500 mt-1">Fast Threads Inc. DTF Workflow Manager</p>
        </div>
      </div>
    </div>
  )
}
