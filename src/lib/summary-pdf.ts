// ============================================
// Batch Summary PDF Generator
// ============================================
// Generates a printable PDF summary sheet for a batch.
// Uses jsPDF for client-side PDF generation.

import jsPDF from 'jspdf'
import { Batch, BatchItem, JobItem, JobSubmission, PLACEMENT_LABELS } from '@/types'

type EnrichedBatchItem = BatchItem & { job_item: JobItem; job: JobSubmission }

/**
 * Generate a summary PDF for a batch.
 * Groups items by invoice number and shows placement details, sizes, quantities.
 */
export function generateBatchSummaryPDF(
  batch: Batch,
  batchItems: EnrichedBatchItem[]
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  const contentWidth = pageWidth - margin * 2
  let y = margin

  // ---- Header ----
  doc.setFillColor(249, 115, 22) // orange
  doc.rect(0, 0, pageWidth, 60, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text('Fast Threads DTF — Batch Summary', margin, 38)
  doc.setFontSize(28)
  doc.text(`#${batch.batch_number}`, pageWidth - margin, 38, { align: 'right' })

  y = 80

  // ---- Batch info line ----
  doc.setTextColor(100, 100, 100)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(
    `Batch #${batch.batch_number}  |  ${new Date(batch.created_at).toLocaleDateString()}  |  ${batch.total_items} total prints  |  Status: ${batch.status.toUpperCase()}`,
    margin,
    y
  )
  y += 20

  // Divider
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(1.5)
  doc.line(margin, y, pageWidth - margin, y)
  y += 15

  // ---- Group by invoice ----
  const groupedByInvoice: Record<string, EnrichedBatchItem[]> = {}
  for (const item of batchItems) {
    const inv = item.job.invoice_number
    if (!groupedByInvoice[inv]) groupedByInvoice[inv] = []
    groupedByInvoice[inv].push(item)
  }

  for (const [invoiceNum, items] of Object.entries(groupedByInvoice)) {
    // Check if we need a new page
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage()
      y = margin
    }

    // Invoice header
    doc.setFillColor(240, 240, 240)
    doc.rect(margin, y - 4, contentWidth, 22, 'F')
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text(`Invoice: ${invoiceNum}`, margin + 8, y + 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(`${items[0].job.location_code}  |  ${items[0].job.submitter_name}`, pageWidth - margin - 8, y + 12, { align: 'right' })
    y += 28

    // Deduplicate items for this invoice
    const seen = new Map<string, { item: EnrichedBatchItem; count: number }>()
    for (const bi of items) {
      if (!seen.has(bi.job_item_id)) {
        seen.set(bi.job_item_id, { item: bi, count: 1 })
      } else {
        seen.get(bi.job_item_id)!.count++
      }
    }

    // Table header
    doc.setTextColor(80, 80, 80)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    const cols = [
      { label: 'File', x: margin + 8, w: 160 },
      { label: 'Placement', x: margin + 170, w: 100 },
      { label: 'Size', x: margin + 275, w: 80 },
      { label: 'Adult Qty', x: margin + 365, w: 55 },
      { label: 'Youth Qty', x: margin + 425, w: 55 },
    ]
    for (const col of cols) {
      doc.text(col.label, col.x, y)
    }
    y += 4
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.5)
    doc.line(margin, y, pageWidth - margin, y)
    y += 10

    // Table rows
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(30, 30, 30)

    for (const { item, count } of seen.values()) {
      if (y > doc.internal.pageSize.getHeight() - 60) {
        doc.addPage()
        y = margin
      }

      const filename = item.job_item.original_filename.length > 28
        ? item.job_item.original_filename.substring(0, 25) + '...'
        : item.job_item.original_filename

      const placement = PLACEMENT_LABELS[item.job_item.placement] +
        (item.job_item.custom_placement_name ? ` (${item.job_item.custom_placement_name})` : '')

      const size = `${item.job_item.target_width_inches}" x ${item.job_item.target_height_inches}"`
      const adultQty = item.job_item.garment_age === 'adult' ? String(count) : '-'
      const youthQty = item.job_item.garment_age === 'youth' ? String(count) : '-'

      doc.text(filename, cols[0].x, y)
      doc.text(placement, cols[1].x, y)
      doc.text(size, cols[2].x, y)
      doc.setFont('helvetica', 'bold')
      doc.text(adultQty, cols[3].x + 20, y, { align: 'center' })
      doc.text(youthQty, cols[4].x + 20, y, { align: 'center' })
      doc.setFont('helvetica', 'normal')

      y += 14
      doc.setDrawColor(230, 230, 230)
      doc.line(margin + 8, y - 4, pageWidth - margin, y - 4)
    }

    y += 10
  }

  // ---- Footer ----
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    const pageH = doc.internal.pageSize.getHeight()

    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(1.5)
    doc.line(margin, pageH - 50, pageWidth - margin, pageH - 50)

    doc.setTextColor(0, 0, 0)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(
      `BATCH #${batch.batch_number} — ${batch.total_items} TOTAL PRINTS — Match this sheet to your gang sheet output`,
      pageWidth / 2,
      pageH - 35,
      { align: 'center' }
    )

    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(150, 150, 150)
    doc.text('Fast Threads Inc. DTF Workflow Manager', pageWidth / 2, pageH - 22, { align: 'center' })
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageH - 22, { align: 'right' })
  }

  return doc
}

/**
 * Generate and download a batch summary PDF.
 */
export function downloadBatchSummaryPDF(
  batch: Batch,
  batchItems: EnrichedBatchItem[]
): void {
  const doc = generateBatchSummaryPDF(batch, batchItems)
  doc.save(`batch-${batch.batch_number}-summary.pdf`)
}
