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
 *
 * @param thumbnails  Optional map of job_item_id -> data URL (PNG) for preview images.
 *                    If provided, a thumbnail column is included in the PDF.
 */
export function generateBatchSummaryPDF(
  batch: Batch,
  batchItems: EnrichedBatchItem[],
  thumbnails?: Record<string, string>
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  const contentWidth = pageWidth - margin * 2
  let y = margin
  const thumbSize = 40
  const rowHeight = thumbnails ? Math.max(thumbSize + 8, 18) : 18

  // ---- Header ----
  doc.setFillColor(249, 115, 22)
  doc.rect(0, 0, pageWidth, 60, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text('Fast Threads DTF \u2014 Batch Summary', margin, 38)
  doc.setFontSize(28)
  doc.text('#' + batch.batch_number, pageWidth - margin, 38, { align: 'right' })

  y = 80

  // ---- Batch info line ----
  doc.setTextColor(100, 100, 100)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(
    'Batch #' + batch.batch_number + '  |  ' + new Date(batch.created_at).toLocaleDateString() + '  |  ' + batch.total_items + ' total prints  |  Status: ' + batch.status.toUpperCase(),
    margin,
    y
  )
  y += 20

  // Divider
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(1.5)
  doc.line(margin, y, pageWidth - margin, y)
  y += 15

  // ---- Column layout ----
  const thumbColW = thumbnails ? 50 : 0
  const cols = [
    { label: 'Preview', x: margin + 8, w: thumbColW },
    { label: 'File', x: margin + 8 + thumbColW, w: 140 },
    { label: 'Placement', x: margin + 8 + thumbColW + 140, w: 100 },
    { label: 'Size', x: margin + 8 + thumbColW + 240, w: 80 },
    { label: 'Adult Qty', x: margin + 8 + thumbColW + 320, w: 55 },
    { label: 'Youth Qty', x: margin + 8 + thumbColW + 380, w: 55 },
  ]

  // ---- Group by invoice ----
  const groupedByInvoice: Record<string, EnrichedBatchItem[]> = {}
  for (const item of batchItems) {
    const inv = item.job.invoice_number
    if (!groupedByInvoice[inv]) groupedByInvoice[inv] = []
    groupedByInvoice[inv].push(item)
  }

  for (const [invoiceNum, items] of Object.entries(groupedByInvoice)) {
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
    doc.text('Invoice: ' + invoiceNum, margin + 8, y + 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(items[0].job.location_code + '  |  ' + items[0].job.submitter_name, pageWidth - margin - 8, y + 12, { align: 'right' })
    y += 28

    // Deduplicate items
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
    const headerCols = thumbnails ? cols : cols.slice(1)
    for (const col of headerCols) {
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

    for (const { item } of seen.values()) {
      if (y > doc.internal.pageSize.getHeight() - 80) {
        doc.addPage()
        y = margin
      }

      // Thumbnail
      if (thumbnails) {
        const thumbDataUrl = thumbnails[item.job_item_id]
        if (thumbDataUrl) {
          try {
            doc.addImage(thumbDataUrl, 'PNG', cols[0].x, y - 6, thumbSize, thumbSize)
          } catch {
            // skip
          }
        }
      }

      const textY = thumbnails ? y + thumbSize / 2 : y

      const filename = item.job_item.original_filename.length > 24
        ? item.job_item.original_filename.substring(0, 21) + '...'
        : item.job_item.original_filename

      const placement = PLACEMENT_LABELS[item.job_item.placement] +
        (item.job_item.custom_placement_name ? ' (' + item.job_item.custom_placement_name + ')' : '')

      const size = item.job_item.target_width_inches + '" x ' + item.job_item.target_height_inches + '"'
      const adultQty = item.job_item.garment_age === 'adult' ? String(item.job_item.quantity) : '-'
      const youthQty = item.job_item.garment_age === 'youth' ? String(item.job_item.quantity) : '-'

      doc.text(filename, cols[1].x, textY)
      doc.text(placement, cols[2].x, textY)
      doc.text(size, cols[3].x, textY)
      doc.setFont('helvetica', 'bold')
      doc.text(adultQty, cols[4].x + 20, textY, { align: 'center' })
      doc.text(youthQty, cols[5].x + 20, textY, { align: 'center' })
      doc.setFont('helvetica', 'normal')

      y += rowHeight
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
      'BATCH #' + batch.batch_number + ' \u2014 ' + batch.total_items + ' TOTAL PRINTS \u2014 Match this sheet to your NeoStampa output',
      pageWidth / 2,
      pageH - 35,
      { align: 'center' }
    )

    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(150, 150, 150)
    doc.text('Fast Threads Inc. DTF Workflow Manager', pageWidth / 2, pageH - 22, { align: 'center' })
    doc.text('Page ' + i + ' of ' + pageCount, pageWidth - margin, pageH - 22, { align: 'right' })
  }

  return doc
}

/**
 * Generate and download a batch summary PDF.
 */
export function downloadBatchSummaryPDF(
  batch: Batch,
  batchItems: EnrichedBatchItem[],
  thumbnails?: Record<string, string>
): void {
  const doc = generateBatchSummaryPDF(batch, batchItems, thumbnails)
  doc.save('batch-' + batch.batch_number + '-summary.pdf')
}
