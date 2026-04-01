// ============================================
// Supabase Data Store
// ============================================
// All data operations go through Supabase.
// File uploads go to Supabase Storage 'dtf-files' bucket.

import { supabase, isSupabaseConfigured } from './supabase'
import { JobSubmission, JobItem, Batch, BatchItem, JobStatus, BatchStatus } from '@/types'

const BUCKET = 'dtf-files'

// ---- Jobs ----

export async function getJobs(status?: JobStatus): Promise<JobSubmission[]> {
  let query = supabase.from('jobs').select('*').order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) { console.error('getJobs error:', error); return [] }
  return data || []
}

export async function getJob(id: string): Promise<JobSubmission | null> {
  const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single()
  if (error) { console.error('getJob error:', error); return null }
  return data
}

export async function createJob(job: Omit<JobSubmission, 'created_at'>): Promise<JobSubmission | null> {
  const { data, error } = await supabase.from('jobs').insert(job).select().single()  if (error) { console.error('createJob error:', error); return null }
  return data
}

export async function updateJobStatus(id: string, status: JobStatus): Promise<void> {
  const { error } = await supabase.from('jobs').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('updateJobStatus error:', error)
}

// ---- Job Items ----

export async function getJobItems(jobId: string): Promise<JobItem[]> {
  const { data, error } = await supabase.from('job_items').select('*').eq('job_id', jobId)
  if (error) { console.error('getJobItems error:', error); return [] }
  return data || []
}

export async function createJobItem(item: Omit<JobItem, 'created_at'>): Promise<JobItem | null> {
  const { data, error } = await supabase.from('job_items').insert(item).select().single()
  if (error) { console.error('createJobItem error:', error); return null }
  return data
}

export async function getUnbatchedItems(): Promise<(JobItem & { job: JobSubmission })[]> {
  // Get all job items that are NOT in any batch
  const { data: batchedIds } = await supabase.from('batch_items').select('job_item_id')
  const batchedSet = new Set((batchedIds || []).map(b => b.job_item_id))
  const { data: items, error } = await supabase
    .from('job_items')
    .select('*, jobs(*)')
    .order('created_at', { ascending: false })

  if (error) { console.error('getUnbatchedItems error:', error); return [] }
  if (!items) return []

  return items
    .filter(item => !batchedSet.has(item.id))
    .filter(item => {
      const job = item.jobs as unknown as JobSubmission
      return job && ['submitted', 'reviewed', 'queued'].includes(job.status)
    })
    .map(item => {
      const job = item.jobs as unknown as JobSubmission
      const { jobs: _, ...jobItem } = item
      return { ...jobItem, job } as JobItem & { job: JobSubmission }
    })
}

// ---- Batches ----

export async function getBatches(status?: BatchStatus): Promise<Batch[]> {
  let query = supabase.from('batches').select('*').order('batch_number', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) { console.error('getBatches error:', error); return [] }
  return data || []
}
export async function getBatch(id: string): Promise<Batch | null> {
  const { data, error } = await supabase.from('batches').select('*').eq('id', id).single()
  if (error) { console.error('getBatch error:', error); return null }
  return data
}

export async function createBatch(batch: Omit<Batch, 'batch_number' | 'created_at'>): Promise<Batch | null> {
  const { data, error } = await supabase.from('batches').insert(batch).select().single()
  if (error) { console.error('createBatch error:', error); return null }
  return data
}

export async function updateBatchStatus(id: string, status: BatchStatus): Promise<void> {
  const { error } = await supabase.from('batches').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('updateBatchStatus error:', error)
}

// ---- Batch Items ----

export async function getBatchItems(batchId: string): Promise<(BatchItem & { job_item: JobItem; job: JobSubmission })[]> {
  const { data, error } = await supabase
    .from('batch_items')
    .select('*, job_items(*, jobs(*))')
    .eq('batch_id', batchId)

  if (error) { console.error('getBatchItems error:', error); return [] }
  if (!data) return []
  return data.map(item => {
    const jobItem = item.job_items as unknown as (JobItem & { jobs: JobSubmission })
    const job = jobItem.jobs as unknown as JobSubmission
    const { jobs: _, ...cleanJobItem } = jobItem as unknown as Record<string, unknown>
    return {
      id: item.id,
      batch_id: item.batch_id,
      job_item_id: item.job_item_id,
      x_position: item.x_position,
      y_position: item.y_position,
      print_width: item.print_width,
      print_height: item.print_height,
      created_at: item.created_at,
      job_item: cleanJobItem as unknown as JobItem,
      job,
    }
  })
}

export async function createBatchItem(item: Omit<BatchItem, 'created_at'>): Promise<BatchItem | null> {
  const { data, error } = await supabase.from('batch_items').insert(item).select().single()
  if (error) { console.error('createBatchItem error:', error); return null }
  return data
}

export async function createBatchItems(items: Omit<BatchItem, 'created_at'>[]): Promise<boolean> {
  const { error } = await supabase.from('batch_items').insert(items)
  if (error) { console.error('createBatchItems error:', error); return false }
  return true
}
export async function deleteBatchItem(batchItemId: string): Promise<boolean> {
  const { error } = await supabase.from('batch_items').delete().eq('id', batchItemId)
  if (error) { console.error('deleteBatchItem error:', error); return false }
  return true
}

export async function updateBatchTotal(batchId: string, totalItems: number): Promise<void> {
  const { error } = await supabase.from('batches').update({ total_items: totalItems, updated_at: new Date().toISOString() }).eq('id', batchId)
  if (error) console.error('updateBatchTotal error:', error)
}

export async function deleteBatch(batchId: string): Promise<boolean> {
  // First get the batch items to know which jobs to revert
  const { data: items } = await supabase.from('batch_items').select('job_item_id, job_items(job_id)').eq('batch_id', batchId)

  // Delete all batch items first
  const { error: itemsErr } = await supabase.from('batch_items').delete().eq('batch_id', batchId)
  if (itemsErr) { console.error('deleteBatch items error:', itemsErr); return false }

  // Delete the batch
  const { error: batchErr } = await supabase.from('batches').delete().eq('id', batchId)
  if (batchErr) { console.error('deleteBatch error:', batchErr); return false }

  // Revert job statuses back to 'queued' so items appear in unbatched pool
  if (items && items.length > 0) {
    const jobIds = new Set(items.map(i => (i.job_items as unknown as { job_id: string })?.job_id).filter(Boolean))
    await Promise.all(Array.from(jobIds).map(jid =>
      supabase.from('jobs').update({ status: 'queued', updated_at: new Date().toISOString() }).eq('id', jid)
    ))
  }
  return true
}

export async function updateJobItemQuantity(jobItemId: string, quantity: number): Promise<boolean> {
  const { error } = await supabase.from('job_items').update({ quantity }).eq('id', jobItemId)
  if (error) { console.error('updateJobItemQuantity error:', error); return false }
  return true
}

// ---- File Storage ----

export async function uploadFile(file: File, path: string): Promise<string | null> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  })
  if (error) { console.error('uploadFile error:', error); return null }
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return urlData.publicUrl
}

export function getFileUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

// ---- Stats ----
export async function getStats() {
  const [
    { count: totalJobs },
    { count: pendingJobs },
    { count: totalBatches },
    { count: readyBatches },
    { count: printedBatches },
  ] = await Promise.all([
    supabase.from('jobs').select('*', { count: 'exact', head: true }),
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'submitted'),
    supabase.from('batches').select('*', { count: 'exact', head: true }),
    supabase.from('batches').select('*', { count: 'exact', head: true }).eq('status', 'ready'),
    supabase.from('batches').select('*', { count: 'exact', head: true }).in('status', ['printed', 'complete']),
  ])

  // Count items in printed/complete batches
  const { data: printedBatchIds } = await supabase
    .from('batches')
    .select('id')
    .in('status', ['printed', 'complete'])
  const ids = (printedBatchIds || []).map(b => b.id)
  let totalItemsPrinted = 0
  if (ids.length > 0) {
    const { count } = await supabase
      .from('batch_items')
      .select('*', { count: 'exact', head: true })
      .in('batch_id', ids)
    totalItemsPrinted = count || 0
  }
  return {
    totalJobs: totalJobs || 0,
    pendingJobs: pendingJobs || 0,
    totalBatches: totalBatches || 0,
    readyBatches: readyBatches || 0,
    printedBatches: printedBatches || 0,
    totalItemsPrinted,
  }
}

// ---- Settings ----

export async function getSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).single()
  if (error || !data) return null
  return data.value as T
}

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  const { error } = await supabase.from('settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })
  if (error) console.error('saveSetting error:', error)
}

// Re-export config check
export { isSupabaseConfigured }
