'use client'

import { useState, useEffect } from 'react'
import * as store from '@/lib/store'
import { JobSubmission, JobItem, PLACEMENT_LABELS } from '@/types'

export default function QueuePage() {
  const [jobs, setJobs] = useState<JobSubmission[]>([])
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [jobItems, setJobItems] = useState<Record<string, JobItem[]>>({})

  useEffect(() => {
    refreshData()
  }, [])

  const refreshData = () => {
    const allJobs = store.getJobs()
      .filter(j => j.status !== 'complete' && j.status !== 'printed')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setJobs(allJobs)
  }

  const toggleExpand = (jobId: string) => {
    if (expandedJob === jobId) {
      setExpandedJob(null)
    } else {
      // Load items for this job
      if (!jobItems[jobId]) {
        const items = store.getJobItems(jobId)
        setJobItems(prev => ({ ...prev, [jobId]: items }))
      }
      setExpandedJob(jobId)
    }
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
        <button
          onClick={refreshData}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">No jobs in the queue</p>
          <p className="text-sm">Jobs submitted from any location will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map(job => (
            <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              {/* Job Header */}
              <button
                onClick={() => toggleExpand(job.id)}
                className="w-full p-4 flex items-center justify-between hover:bg-gray-800/50 transition-colors text-left"
              >
                <div className="flex items-center gap-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[job.status]}`}>
                    {job.status.toUpperCase()}
                  </span>
                  <div>
                    <span className="font-semibold">#{job.invoice_number}</span>
                    <span className="text-gray-500 mx-2">|</span>
                    <span className="text-sm text-gray-400">{job.location_code}</span>
                    <span className="text-gray-500 mx-2">|</span>
                    <span className="text-sm text-gray-400">{job.submitter_name}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-gray-500">
                    {new Date(job.created_at).toLocaleString()}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-500 transition-transform ${expandedJob === job.id ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Job Items (expanded) */}
              {expandedJob === job.id && jobItems[job.id] && (
                <div className="border-t border-gray-800 p-4">
                  {job.notes && (
                    <p className="text-sm text-gray-400 mb-3 italic">Notes: {job.notes}</p>
                  )}
                  <div className="space-y-3">
                    {jobItems[job.id].map(item => {
                      const thumbUrl = store.getFileUrl(item.file_url)
                      return (
                        <div key={item.id} className="flex items-center gap-4 p-3 bg-gray-800/50 rounded-lg">
                          {thumbUrl && (
                            <img
                              src={thumbUrl}
                              alt={item.original_filename}
                              className="w-16 h-16 object-contain bg-gray-700 rounded"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.original_filename}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {PLACEMENT_LABELS[item.placement]}
                              {item.custom_placement_name ? ` (${item.custom_placement_name})` : ''}
                              {' | '}
                              {item.garment_age === 'youth' ? 'Youth' : 'Adult'}
                              {' | '}
                              {item.target_width_inches}&quot; x {item.target_height_inches}&quot;
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold">{item.quantity}</p>
                            <p className="text-xs text-gray-500">qty</p>
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
