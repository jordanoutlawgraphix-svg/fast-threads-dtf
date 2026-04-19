'use client'

import { useState, useEffect, use } from 'react'
import * as store from '@/lib/store'
import { Batch, BatchItem, JobItem, JobSubmission, PLACEMENT_LABELS } from '@/types'
import { downloadBatchZip } from '@/lib/batch-export'
import { generateBatchSummaryPDF, downloadBatchSummaryPDF } from '@/lib/summary-pdf'
import { renderPdfThumbnailFromUrl } from '@/lib/pdf-utils'
import { useRouter } from 'next/navigation'

type EnrichedBatchItem = BatchItem & { job_item: JobItem; job: JobSubmission }

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [batch, setBatch] = useState<Batch | null>(null)
  const [batchItems, setBatchItems] = useState<EnrichedBatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [editingQty, setEditingQty] = useState<string | null>(null)
  const [editQtyValue, setEditQtyValue] = useState<number>(1)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(false)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})

  useEffect(() => {
    loadData()
  }, [id])

  const loadData = async () => {
    setLoading(true)
    const [b, items] = await Promise.all([store.getBatch(id), store.getBatchItems(id)])
    setBatch(b)
    setBatchItems(items)
    setLoading(false)

    // Render PDF thumbnails in background
    for (const item of items) {
      const filePath = item.job_item.file_path
      if (filePath && !thumbnails[item.job_item_id]) {
        const url = store.getFileUrl(filePath)
        renderPdfThumbnailFromUrl(url, 120).then(dataUrl => {
          setThumbnails(prev => ({ ...prev, [item.job_item_id]: dataUrl }))
        }).catch(() => {})
      }
    }
  }

  const markAsPrinting = async () => {
    await store.updateBatchStatus(id, 'printing')
    setBatch(prev => prev ? { ...prev, status: 'printing' } : null)
  }

  const markAsPrinted = async () => {
    await store.updateBatchStatus(id, 'printed')
    setBatch(prev => prev ? { ...prev, status: 'printed' } : null)
  }

  const markAsComplete = async () => {
    await store.updateBatchStatus(id, 'complete')
    setBatch(prev => prev ? { ...prev, status: 'complete' } : null)
    const jobIds = new Set(batchItems.map(bi => bi.job.id))
    await Promise.all(Array.from(jobIds).map(jid => store.updateJobStatus(jid, 'complete')))
  }

  // ---- Edit / Delete handlers ----

  const handleEditQuantity = (jobItemId: string, currentQty: number) => {
    setEditingQty(jobItemId)
    setEditQtyValue(currentQty)
  }

  const handleSaveQuantity = async (jobItemId: string) => {
    if (editQtyValue < 1) return
    await store.updateJobItemQuantity(jobItemId, editQtyValue)
    setEditingQty(null)

    const updatedItems = batchItems.map(bi =>
      bi.job_item_id === jobItemId
        ? { ...bi, job_item: { ...bi.job_item, quantity: editQtyValue } }
        : bi
    )
    setBatchItems(updatedItems)

    const seen = new Set<string>()
    let total = 0
    for (const bi of updatedItems) {
      if (!seen.has(bi.job_item_id)) {
        seen.add(bi.job_item_id)
        total += bi.job_item.quantity
      }
    }
    await store.updateBatchTotal(id, total)
    setBatch(prev => prev ? { ...prev, total_items: total } : null)
  }

  const handleDeleteItem = async (batchItemId: string, jobItemId: string) => {
    const toDelete = batchItems.filter(bi => bi.job_item_id === jobItemId)
    for (const bi of toDelete) {
      await store.deleteBatchItem(bi.id)
    }

    const remaining = batchItems.filter(bi => bi.job_item_id !== jobItemId)
    setBatchItems(remaining)
    setConfirmDelete(null)

    if (remaining.length === 0) {
      await store.deleteBatch(id)
      router.push('/batch')
      return
    }

    const seen = new Set<string>()
    let total = 0
    for (const bi of remaining) {
      if (!seen.has(bi.job_item_id)) {
        seen.add(bi.job_item_id)
        total += bi.job_item.quantity
      }
    }
    await store.updateBatchTotal(id, total)
    setBatch(prev => prev ? { ...prev, total_items: total } : null)

    const deletedJobId = toDelete[0]?.job?.id
    if (deletedJobId) {
      const otherItemsInBatch = remaining.some(bi => bi.job.id === deletedJobId)
      if (!otherItemsInBatch) {
        await store.updateJobStatus(deletedJobId, 'queued')
      }
    }
  }

  const handleDeleteBatch = async () => {
    await store.deleteBatch(id)
    router.push('/batch')
  }

  const handleDownloadZip = async () => {
    if (!batch) return
    setExporting(true)
    try {
      const summaryDoc = generateBatchSummaryPDF(batch, batchItems)
      await downloadBatchZip(
        batch,
        batchItems,
        async (jobItem: JobItem) => {
          const url = store.getFileUrl(jobItem.file_path)
          const res = await fetch(url)
          if (!res.ok) throw new Error(`Failed to fetch ${jobItem.original_filename}`)
          return res.blob()
        },
        summaryDoc,
      )
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

  const canEdit = ['ready', 'building'].includes(batch.status)

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
            <button onClick={handleDownloadZip} disabled={exporting}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-medium disabled:opacity-50">
              {exporting ? 'Building ZIP...' : 'Download PDFs (ZIP)'}
            </button>
            <button onClick={handleDownloadPDF}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 text-sm">
              Download Summary PDF
            </button>
            <button onClick={() => window.print()}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
              Print Summary
            </button>
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
            {canEdit && (
              confirmDeleteBatch ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-400">Delete entire batch?</span>
                  <button onClick={handleDeleteBatch} className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium">Yes, Delete</button>
                  <button onClick={() => setConfirmDeleteBatch(false)} className="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDeleteBatch(true)} className="px-4 py-2 bg-red-600/20 text-red-400 border border-red-800/50 rounded-lg hover:bg-red-600/30 text-sm">
                  Delete Batch
                </button>
              )
            )}
          </div>
        </div>

        {canEdit && (
          <div className="mb-4 px-3 py-2 bg-blue-900/20 border border-blue-800/40 rounded-lg text-sm text-blue-300">
            This batch is editable. You can change quantities or remove items below.
          </div>
        )}
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
                      <th className="py-1 text-center">Qty</th>
                      {canEdit && <th className="py-1 text-center no-print">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(seen.values()).map(({ item, count }) => {
                      const thumbUrl = thumbnails[item.job_item_id] || null
                      const isEditing = editingQty === item.job_item_id
                      const isDeleting = confirmDelete === item.job_item_id

                      return (
                        <tr key={item.job_item_id} className="border-b border-gray-200">
                          <td className="py-2">
                            {thumbUrl ? (
                              <img src={thumbUrl} alt="" className="w-14 h-14 object-contain border border-gray-200" />
                            ) : (
                              <div className="w-14 h-14 border border-gray-200 flex items-center justify-center bg-gray-50">
                                <span className="text-[10px] text-gray-400">PDF</span>
                              </div>
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
                            {isEditing ? (
                              <div className="flex items-center justify-center gap-1 no-print">
                                <input
                                  type="number"
                                  min={1}
                                  value={editQtyValue}
                                  onChange={(e) => setEditQtyValue(Math.max(1, parseInt(e.target.value) || 1))}
                                  className="w-14 px-1 py-0.5 border border-gray-400 rounded text-center text-sm"
                                />
                                <button onClick={() => handleSaveQuantity(item.job_item_id)} className="px-1.5 py-0.5 bg-green-600 text-white rounded text-xs">Save</button>
                                <button onClick={() => setEditingQty(null)} className="px-1.5 py-0.5 bg-gray-400 text-white rounded text-xs">X</button>
                              </div>
                            ) : (
                              <span>{item.job_item.quantity}</span>
                            )}
                          </td>
                          {canEdit && (
                            <td className="py-2 text-center no-print">
                              {isDeleting ? (
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => handleDeleteItem(item.id, item.job_item_id)} className="px-2 py-0.5 bg-red-600 text-white rounded text-xs">Remove</button>
                                  <button onClick={() => setConfirmDelete(null)} className="px-2 py-0.5 bg-gray-400 text-white rounded text-xs">Cancel</button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => handleEditQuantity(item.job_item_id, item.job_item.quantity)}
                                    className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200" title="Edit quantity">
                                    Edit Qty
                                  </button>
                                  <button onClick={() => setConfirmDelete(item.job_item_id)}
                                    className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200" title="Remove from batch">
                                    Delete
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
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
            BATCH #{batch.batch_number} — {batch.total_items} TOTAL PRINTS — Download ZIP and load into NeoStampa
          </p>
          <p className="text-xs text-gray-500 mt-1">Fast Threads Inc. DTF Workflow Manager</p>
        </div>
      </div>
    </div>
  )
}
