'use client'

import { useState, useEffect } from 'react'
import * as store from '@/lib/store'
import { JobSubmission, JobItem, PLACEMENT_LABELS } from '@/types'
import { renderPdfThumbnailFromUrl } from '@/lib/pdf-utils'

export default function QueuePage() {
  const [jobs, setJobs] = useState<JobSubmission[]>([])
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [jobItems, setJobItems] = useState<Record<string, JobItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<string | null>(null)
  const [confirmDeleteJob, setConfirmDeleteJob] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [editQty, setEditQty] = useState<number>(1)
  const [editWidth, setEditWidth] = useState<number>(0)
  const [editHeight, setEditHeight] = useState<number>(0)

  useEffect(() => { refreshData() }, [])

  const refreshData = async () => {
    setLoading(true)
    const allJobs = await store.getJobs()
    setJobs(allJobs.filter(j => j.status !== 'complete' && j.status !== 'printed'))
    setLoading(false)
  }

  const toggleExpand = async (jobId: string) => {
    if (expandedJob === jobId) { setExpandedJob(null); return }
    if (!jobItems[jobId]) {
      const items = await store.getJobItems(jobId)
      setJobItems(prev => ({ ...prev, [jobId]: items }))

      // Generate PDF thumbnails in background
      for (const item of items) {
        if (item.file_path && !thumbnails[item.id]) {
          const url = store.getFileUrl(item.file_path)
          renderPdfThumbnailFromUrl(url, 120).then(dataUrl => {
            setThumbnails(prev => ({ ...prev, [item.id]: dataUrl }))
          }).catch(() => {})
        }
      }
    }
    setExpandedJob(jobId)
  }

  const handleDeleteItem = async (jobId: string, itemId: string) => {
    await store.deleteJobItem(itemId)
    const remaining = (jobItems[jobId] || []).filter(i => i.id !== itemId)
    if (remaining.length === 0) {
      // Auto-delete empty job
      await store.deleteJob(jobId)
      setJobs(prev => prev.filter(j => j.id !== jobId))
      setJobItems(prev => { const next = { ...prev }; delete next[jobId]; return next })
      setExpandedJob(null)
    } else {
      setJobItems(prev => ({ ...prev, [jobId]: remaining }))
    }
    setConfirmDeleteItem(null)
  }

  const handleDeleteJob = async (jobId: string) => {
    await store.deleteJob(jobId)
    setJobs(prev => prev.filter(j => j.id !== jobId))
    setJobItems(prev => { const next = { ...prev }; delete next[jobId]; return next })
    setExpandedJob(null)
    setConfirmDeleteJob(null)
  }

  const startEditing = (item: JobItem) => {
    setEditingItem(item.id)
    setEditQty(item.quantity)
    setEditWidth(item.target_width_inches)
    setEditHeight(item.target_height_inches)
  }

  const handleSaveEdit = async (jobId: string, item: JobItem) => {
    const qtyChanged = editQty !== item.quantity
    const sizeChanged = editWidth !== item.target_width_inches || editHeight !== item.target_height_inches
    if (qtyChanged) await store.updateJobItemQuantity(item.id, editQty)
    if (sizeChanged) await store.updateJobItemSize(item.id, editWidth, editHeight)
    // Update local state
    setJobItems(prev => ({
      ...prev,
      [jobId]: (prev[jobId] || []).map(i =>
        i.id === item.id ? { ...i, quantity: editQty, target_width_inches: editWidth, target_height_inches: editHeight } : i
      )
    }))
    setEditingItem(null)
  }

  const handleEditWidthChange = (newWidth: number, item: JobItem) => {
    setEditWidth(newWidth)
    const aspect = item.source_width_px / item.source_height_px
    if (aspect > 0) setEditHeight(Math.round((newWidth / aspect) * 100) / 100)
  }

  const handleEditHeightChange = (newHeight: number, item: JobItem) => {
    setEditHeight(newHeight)
    const aspect = item.source_width_px / item.source_height_px
    if (aspect > 0) setEditWidth(Math.round((newHeight * aspect) * 100) / 100)
  }

  const statusColors: Record<string, string> = {
    submitted: 'bg-yellow-500/20 text-yellow-300',
    reviewed: 'bg-blue-500/20 text-blue-300',
    queued: 'bg-purple-500/20 text-purple-300',
    batched: 'bg-green-500/20 text-green-300',
    printed: 'bg-green-700/20 text-green-200',
    complete: 'bg-gray-500/20 text-gray-300',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Print Queue</h1>
        <button onClick={refreshData} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">No jobs in the queue</p>
          <p className="text-sm">Jobs submitted from any location will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map(job => (
            <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="flex items-center">
                <button onClick={() => toggleExpand(job.id)}
                  className="flex-1 p-4 flex items-center justify-between hover:bg-gray-800/50 transition-colors text-left">
                  <div className="flex items-center gap-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[job.status]}`}>{job.status.toUpperCase()}</span>
                    <div>
                      <span className="font-semibold">#{job.invoice_number}</span>
                      <span className="text-gray-500 mx-2">|</span>
                      <span className="text-sm text-gray-400">{job.location_code}</span>
                      <span className="text-gray-500 mx-2">|</span>
                      <span className="text-sm text-gray-400">{job.submitter_name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-500">{new Date(job.created_at).toLocaleString()}</span>
                    <svg className={`w-4 h-4 text-gray-500 transition-transform ${expandedJob === job.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>
                {/* Delete Job button */}
                {['submitted', 'reviewed', 'queued'].includes(job.status) && (
                  confirmDeleteJob === job.id ? (
                    <div className="flex items-center gap-1 pr-3">
                      <button onClick={() => handleDeleteJob(job.id)} className="px-2 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700">Delete</button>
                      <button onClick={() => setConfirmDeleteJob(null)} className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteJob(job.id) }}
                      className="px-2 py-2 mr-2 text-red-400/60 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                      title="Delete job"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )
                )}
              </div>
              {expandedJob === job.id && jobItems[job.id] && (
                <div className="border-t border-gray-800 p-4">
                  {job.notes && <p className="text-sm text-gray-400 mb-3 italic">Notes: {job.notes}</p>}
                  <div className="space-y-3">
                    {jobItems[job.id].map(item => {
                      const thumbUrl = thumbnails[item.id] || null
                      const isDeleting = confirmDeleteItem === item.id
                      return (
                        <div key={item.id} className="flex items-center gap-4 p-3 bg-gray-800/50 rounded-lg">
                          {thumbUrl ? (
                            <img src={thumbUrl} alt={item.original_filename} className="w-16 h-16 object-contain bg-gray-700 rounded" />
                          ) : (
                            <div className="w-16 h-16 bg-gray-700 rounded flex items-center justify-center">
                              <span className="text-[10px] text-gray-500">PDF</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.original_filename}</p>
                            {editingItem === item.id ? (
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <span className="text-xs text-gray-500">{PLACEMENT_LABELS[item.placement]} | {item.garment_age === 'youth' ? 'Youth' : 'Adult'}</span>
                                <div className="flex items-center gap-1">
                                  <label className="text-xs text-gray-500">W:</label>
                                  <input type="number" step="0.25" min="0.5" value={editWidth}
                                    onChange={e => handleEditWidthChange(parseFloat(e.target.value) || 0, item)}
                                    className="w-16 px-1 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs" />
                                </div>
                                <div className="flex items-center gap-1">
                                  <label className="text-xs text-gray-500">H:</label>
                                  <input type="number" step="0.25" min="0.5" value={editHeight}
                                    onChange={e => handleEditHeightChange(parseFloat(e.target.value) || 0, item)}
                                    className="w-16 px-1 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs" />
                                </div>
                                <div className="flex items-center gap-1">
                                  <label className="text-xs text-gray-500">Qty:</label>
                                  <input type="number" min={1} value={editQty}
                                    onChange={e => setEditQty(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="w-14 px-1 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs" />
                                </div>
                                <button onClick={() => handleSaveEdit(job.id, item)}
                                  className="px-2 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">Save</button>
                                <button onClick={() => setEditingItem(null)}
                                  className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600">Cancel</button>
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400 mt-1">
                                {PLACEMENT_LABELS[item.placement]}{item.custom_placement_name ? ` (${item.custom_placement_name})` : ''}{' | '}
                                {item.garment_age === 'youth' ? 'Youth' : 'Adult'}{' | '}{item.target_width_inches}&quot; x {item.target_height_inches}&quot;
                              </p>
                            )}
                          </div>
                          <div className="text-right flex items-center gap-3">
                            {editingItem !== item.id && (
                              <div>
                                <p className="text-lg font-bold">{item.quantity}</p>
                                <p className="text-xs text-gray-500">qty</p>
                              </div>
                            )}
                            {['submitted', 'reviewed', 'queued'].includes(job.status) && editingItem !== item.id && (
                              <div className="flex flex-col gap-1">
                                <button onClick={() => startEditing(item)}
                                  className="px-2 py-1 text-orange-400/80 hover:text-orange-400 text-xs hover:bg-orange-900/20 rounded transition-colors">
                                  Edit
                                </button>
                                {isDeleting ? (
                                  <>
                                    <button onClick={() => handleDeleteItem(job.id, item.id)} className="px-2 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700">Delete</button>
                                    <button onClick={() => setConfirmDeleteItem(null)} className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600">Cancel</button>
                                  </>
                                ) : (
                                  <button onClick={() => setConfirmDeleteItem(item.id)}
                                    className="px-2 py-1 text-red-400/60 hover:text-red-400 text-xs hover:bg-red-900/20 rounded transition-colors">
                                    Delete
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
