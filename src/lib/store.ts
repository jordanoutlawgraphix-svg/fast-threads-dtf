// ============================================
// Local Data Store
// ============================================
// In-memory store with optional Supabase sync.
// This lets the app work in demo mode without Supabase,
// and syncs to Supabase when configured.

import { JobSubmission, JobItem, Batch, BatchItem, JobStatus, BatchStatus } from '@/types'

// In-memory state
let jobs: JobSubmission[] = []
let jobItems: JobItem[] = []
let batches: Batch[] = []
let batchItems: BatchItem[] = []
let nextBatchNumber = 1

// File storage (in-memory for demo, Supabase Storage when connected)
const fileStore: Map<string, string> = new Map() // id -> data URL

// ---- Jobs ----

export function getJobs(status?: JobStatus): JobSubmission[] {
  if (status) return jobs.filter(j => j.status === status)
  return [...jobs]
}

export function getJob(id: string): JobSubmission | undefined {
  return jobs.find(j => j.id === id)
}

export function createJob(job: JobSubmission): JobSubmission {
  jobs.push(job)
  return job
}

export function updateJobStatus(id: string, status: JobStatus): void {
  const job = jobs.find(j => j.id === id)
  if (job) job.status = status
}

// ---- Job Items ----

export function getJobItems(jobId: string): JobItem[] {
  return jobItems.filter(ji => ji.job_id === jobId)
}

export function getJobItem(id: string): JobItem | undefined {
  return jobItems.find(ji => ji.id === id)
}

export function createJobItem(item: JobItem): JobItem {
  jobItems.push(item)
  return item
}

export function getUnbatchedItems(): (JobItem & { job: JobSubmission })[] {
  const batchedItemIds = new Set(batchItems.map(bi => bi.job_item_id))
  return jobItems
    .filter(ji => !batchedItemIds.has(ji.id))
    .filter(ji => {
      const job = jobs.find(j => j.id === ji.job_id)
      return job && (job.status === 'submitted' || job.status === 'reviewed' || job.status === 'queued')
    })
    .map(ji => ({
      ...ji,
      job: jobs.find(j => j.id === ji.job_id)!,
    }))
}

// ---- Batches ----

export function getBatches(status?: BatchStatus): Batch[] {
  if (status) return batches.filter(b => b.status === status)
  return [...batches]
}

export function getBatch(id: string): Batch | undefined {
  return batches.find(b => b.id === id)
}

export function createBatch(batch: Omit<Batch, 'batch_number'>): Batch {
  const newBatch: Batch = {
    ...batch,
    batch_number: nextBatchNumber++,
  }
  batches.push(newBatch)
  return newBatch
}

export function updateBatchStatus(id: string, status: BatchStatus): void {
  const batch = batches.find(b => b.id === id)
  if (batch) batch.status = status
}

// ---- Batch Items ----

export function getBatchItems(batchId: string): (BatchItem & { job_item: JobItem; job: JobSubmission })[] {
  return batchItems
    .filter(bi => bi.batch_id === batchId)
    .map(bi => {
      const jobItem = jobItems.find(ji => ji.id === bi.job_item_id)!
      const job = jobs.find(j => j.id === jobItem.job_id)!
      return { ...bi, job_item: jobItem, job }
    })
}

export function createBatchItem(item: BatchItem): BatchItem {
  batchItems.push(item)
  // Update the job status
  const jobItem = jobItems.find(ji => ji.id === item.job_item_id)
  if (jobItem) {
    updateJobStatus(jobItem.job_id, 'batched')
  }
  return item
}

// ---- File Storage ----

export function storeFile(id: string, dataUrl: string): void {
  fileStore.set(id, dataUrl)
}

export function getFileUrl(id: string): string | null {
  return fileStore.get(id) || null
}

// ---- Stats ----

export function getStats() {
  return {
    totalJobs: jobs.length,
    pendingJobs: jobs.filter(j => j.status === 'submitted').length,
    totalBatches: batches.length,
    readyBatches: batches.filter(b => b.status === 'ready').length,
    printedBatches: batches.filter(b => b.status === 'printed' || b.status === 'complete').length,
    totalItemsPrinted: batchItems.filter(bi => {
      const batch = batches.find(b => b.id === bi.batch_id)
      return batch && (batch.status === 'printed' || batch.status === 'complete')
    }).length,
  }
}

// ---- Reset (for testing) ----

export function resetStore(): void {
  jobs = []
  jobItems = []
  batches = []
  batchItems = []
  nextBatchNumber = 1
  fileStore.clear()
}
