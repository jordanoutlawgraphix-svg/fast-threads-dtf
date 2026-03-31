// ============================================
// Gang Sheet PNG Export
// ============================================
// Renders gang sheet layout to Canvas and exports as PNG.
// The exported PNG can be placed in the CADlink hot folder
// or downloaded manually.

import { GangSheetLayout } from './gang-sheet-engine'
import { GangSheetConfig, DEFAULT_GANG_SHEET_CONFIG } from '@/types'

interface ExportOptions {
  config?: GangSheetConfig
  /** If true, load and render actual print images. Otherwise render placeholder boxes. */
  renderImages?: boolean
  /** Map of item_id -> image URL for rendering actual artwork */
  imageUrls?: Record<string, string>
}

/**
 * Render a gang sheet layout to a PNG blob.
 * Uses an offscreen canvas at the configured DPI.
 */
export async function exportGangSheetPNG(
  layout: GangSheetLayout,
  options: ExportOptions = {}
): Promise<Blob> {
  const config = options.config || DEFAULT_GANG_SHEET_CONFIG
  const dpi = config.dpi
  const renderImages = options.renderImages ?? false
  const imageUrls = options.imageUrls || {}

  // Calculate pixel dimensions
  const widthPx = Math.round(layout.sheet_width * dpi)
  const heightPx = Math.round(layout.sheet_height * dpi)

  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas 2d context')

  // White background
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, widthPx, heightPx)

  // Draw START batch label
  const labelHeightPx = config.batch_label_height_inches * dpi
  ctx.fillStyle = '#f97316' // orange
  ctx.fillRect(0, 0, widthPx, labelHeightPx)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `bold ${Math.round(labelHeightPx * 0.6)}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`START BATCH #${layout.batch_number}`, widthPx / 2, labelHeightPx / 2)

  // Draw END batch label
  const endLabelY = heightPx - labelHeightPx
  ctx.fillStyle = '#f97316'
  ctx.fillRect(0, endLabelY, widthPx, labelHeightPx)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText(`END BATCH #${layout.batch_number}`, widthPx / 2, endLabelY + labelHeightPx / 2)

  // Load images if requested
  const loadedImages: Record<string, HTMLImageElement> = {}
  if (renderImages) {
    const imagePromises = layout.placed_items.map(async (item) => {
      const url = imageUrls[item.item_id]
      if (!url || loadedImages[item.item_id]) return
      try {
        const img = await loadImage(url)
        loadedImages[item.item_id] = img
      } catch {
        // Skip failed images, will render placeholder
      }
    })
    await Promise.all(imagePromises)
  }

  // Draw each placed item
  for (const item of layout.placed_items) {
    const x = Math.round(item.x * dpi)
    const y = Math.round(item.y * dpi)
    const w = Math.round(item.width * dpi)
    const h = Math.round(item.height * dpi)

    const img = loadedImages[item.item_id]
    if (img) {
      // Draw actual artwork scaled to fit
      ctx.drawImage(img, x, y, w, h)
    } else {
      // Placeholder box
      ctx.fillStyle = '#e5e7eb'
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = '#9ca3af'
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, w, h)

      // Label
      ctx.fillStyle = '#374151'
      const fontSize = Math.min(Math.round(w / 12), Math.round(h / 4), 24)
      ctx.font = `${fontSize}px Arial`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(item.invoice_number, x + w / 2, y + h / 2 - fontSize * 0.6)
      ctx.font = `${Math.round(fontSize * 0.7)}px Arial`
      ctx.fillText(`${item.width.toFixed(1)}" x ${item.height.toFixed(1)}"`, x + w / 2, y + h / 2 + fontSize * 0.6)
    }

    // Draw thin border around each item for cutting guides
    ctx.strokeStyle = '#d1d5db'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, w, h)
  }

  // Convert to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to export canvas to PNG'))
      },
      'image/png',
      1.0
    )
  })
}

/**
 * Download a gang sheet as PNG file.
 */
export async function downloadGangSheetPNG(
  layout: GangSheetLayout,
  options: ExportOptions = {}
): Promise<void> {
  const blob = await exportGangSheetPNG(layout, options)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gang-sheet-batch-${layout.batch_number}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Load an image from URL, returns a promise.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}
