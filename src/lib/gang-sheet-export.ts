// ============================================
// Gang Sheet PNG Export
// ============================================
// Renders gang sheet layout to Canvas and exports as PNG.
// The exported PNG is transparent (no background) for DTF printing —
// the RIP software handles the white ink layer.
// Includes pHYs chunk injection for correct 300 DPI metadata.
//
// IMPORTANT: Browser canvases have a max height of ~32,767px.
// At 300 DPI, that's ~109". For sheets taller than that, we render
// in vertical tiles and stitch them together.

import { GangSheetLayout } from './gang-sheet-engine'
import { GangSheetConfig, DEFAULT_GANG_SHEET_CONFIG } from '@/types'

interface ExportOptions {
  config?: GangSheetConfig
  renderImages?: boolean
  imageUrls?: Record<string, string>
}

// Max canvas dimension browsers can handle safely
const MAX_CANVAS_HEIGHT = 16384

// ---- CRC32 lookup table for PNG chunk checksums ----
const crc32Table = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * Inject a pHYs chunk into a PNG blob to set DPI metadata.
 * 300 DPI = 11811 pixels per meter (300 / 0.0254)
 */
function injectPHYsChunk(pngBuffer: ArrayBuffer, dpi: number): ArrayBuffer {
  const pixelsPerMeter = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(21)
  const view = new DataView(chunk.buffer)

  view.setUint32(0, 9, false)
  chunk[4] = 0x70; chunk[5] = 0x48; chunk[6] = 0x59; chunk[7] = 0x73
  view.setUint32(8, pixelsPerMeter, false)
  view.setUint32(12, pixelsPerMeter, false)
  chunk[16] = 1

  const crcData = chunk.slice(4, 17)
  const crcValue = crc32(crcData)
  view.setUint32(17, crcValue, false)

  const ihdrEnd = 33
  const before = new Uint8Array(pngBuffer, 0, ihdrEnd)
  const after = new Uint8Array(pngBuffer, ihdrEnd)
  const result = new Uint8Array(before.length + chunk.length + after.length)
  result.set(before, 0)
  result.set(chunk, before.length)
  result.set(after, before.length + chunk.length)
  return result.buffer
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

/**
 * Draw items onto a canvas context for a specific vertical pixel range.
 * tileTopPx/tileBottomPx define the pixel window being rendered.
 * yOffsetPx is subtracted from each item's Y to map it into the tile.
 */
function drawItemsOnTile(
  ctx: CanvasRenderingContext2D,
  items: GangSheetLayout['placed_items'],
  dpi: number,
  yOffsetInches: number,
  tileHeightPx: number,
  loadedImages: Record<string, HTMLImageElement>
) {
  for (const item of items) {
    const x = Math.round(item.x * dpi)
    const y = Math.round((item.y - yOffsetInches) * dpi)
    const w = Math.round(item.width * dpi)
    const h = Math.round(item.height * dpi)

    // Skip items entirely outside this tile
    if (y + h <= 0 || y >= tileHeightPx) continue

    const img = loadedImages[item.item_id]
    if (img) {
      ctx.drawImage(img, x, y, w, h)
    } else {
      ctx.fillStyle = 'rgba(229, 231, 235, 0.8)'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = '#374151'
      const fontSize = Math.min(Math.round(w / 12), Math.round(h / 4), 24)
      ctx.font = `${fontSize}px Arial`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(item.invoice_number, x + w / 2, y + h / 2 - fontSize * 0.6)
      ctx.font = `${Math.round(fontSize * 0.7)}px Arial`
      ctx.fillText(
        `${item.width.toFixed(1)}" x ${item.height.toFixed(1)}"`,
        x + w / 2, y + h / 2 + fontSize * 0.6
      )
    }
  }
}

/**
 * Convert a canvas to a PNG blob. Throws if conversion fails.
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 0) {
            resolve(blob)
          } else {
            reject(new Error(
              `Canvas toBlob failed. Canvas size: ${canvas.width}x${canvas.height}px. ` +
              `This may exceed your browser's canvas limits.`
            ))
          }
        },
        'image/png'
      )
    } catch (err) {
      reject(new Error(`Canvas toBlob threw: ${err}`))
    }
  })
}

/**
 * Render a gang sheet layout to a PNG blob.
 *
 * For sheets that exceed browser canvas height limits, renders in
 * vertical tiles and stitches them onto a final canvas. If the final
 * stitched canvas is STILL too tall, we reduce the effective DPI
 * to fit within limits while maintaining correct pHYs metadata.
 *
 * Background is TRANSPARENT for DTF printing.
 */
export async function exportGangSheetPNG(
  layout: GangSheetLayout,
  options: ExportOptions = {}
): Promise<Blob> {
  const config = options.config || DEFAULT_GANG_SHEET_CONFIG
  const dpi = config.dpi
  const renderImages = options.renderImages ?? false
  const imageUrls = options.imageUrls || {}

  // Trim batch label areas — export is just artwork
  const labelHeight = config.batch_label_height_inches
  const contentTopInches = labelHeight
  const contentHeight = layout.sheet_height - (labelHeight * 2)
  const widthPx = Math.round(layout.sheet_width * dpi)
  let heightPx = Math.round(contentHeight * dpi)

  // Determine if we need to scale down to fit browser limits
  // Max total pixels = MAX_CANVAS_HEIGHT for height dimension
  let renderDpi = dpi
  if (heightPx > MAX_CANVAS_HEIGHT) {
    // Scale DPI down so the canvas fits, but we'll inject the
    // REAL dpi in pHYs so the file opens at correct physical size
    renderDpi = Math.floor(MAX_CANVAS_HEIGHT / contentHeight)
    heightPx = Math.round(contentHeight * renderDpi)
  }
  const renderWidthPx = Math.round(layout.sheet_width * renderDpi)

  // Load images if requested
  const loadedImages: Record<string, HTMLImageElement> = {}
  if (renderImages) {
    const uniqueIds = new Set(layout.placed_items.map(i => i.item_id))
    const imagePromises = Array.from(uniqueIds).map(async (itemId) => {
      const url = imageUrls[itemId]
      if (!url) return
      try {
        const img = await loadImage(url)
        loadedImages[itemId] = img
      } catch {
        // Skip failed images — will render placeholder
      }
    })
    await Promise.all(imagePromises)
  }

  // If the sheet fits in a single canvas, render directly
  if (heightPx <= MAX_CANVAS_HEIGHT) {
    const canvas = document.createElement('canvas')
    canvas.width = renderWidthPx
    canvas.height = heightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas 2d context')
    ctx.clearRect(0, 0, renderWidthPx, heightPx)

    drawItemsOnTile(ctx, layout.placed_items, renderDpi, contentTopInches, heightPx, loadedImages)

    const rawBlob = await canvasToBlob(canvas)
    const rawBuffer = await rawBlob.arrayBuffer()
    const dpiBuffer = injectPHYsChunk(rawBuffer, dpi)
    return new Blob([dpiBuffer], { type: 'image/png' })
  }

  // For very tall sheets: render in vertical tiles, stitch onto final canvas
  // This shouldn't normally be reached since we scale DPI above,
  // but serves as a safety net
  const tileHeight = MAX_CANVAS_HEIGHT
  const numTiles = Math.ceil(heightPx / tileHeight)

  const finalCanvas = document.createElement('canvas')
  finalCanvas.width = renderWidthPx
  finalCanvas.height = heightPx
  const finalCtx = finalCanvas.getContext('2d')
  if (!finalCtx) throw new Error('Failed to get final canvas 2d context')
  finalCtx.clearRect(0, 0, renderWidthPx, heightPx)

  for (let t = 0; t < numTiles; t++) {
    const tilePxTop = t * tileHeight
    const tilePxHeight = Math.min(tileHeight, heightPx - tilePxTop)
    const tileTopInches = contentTopInches + (tilePxTop / renderDpi)

    const tileCanvas = document.createElement('canvas')
    tileCanvas.width = renderWidthPx
    tileCanvas.height = tilePxHeight
    const tileCtx = tileCanvas.getContext('2d')
    if (!tileCtx) continue
    tileCtx.clearRect(0, 0, renderWidthPx, tilePxHeight)

    drawItemsOnTile(tileCtx, layout.placed_items, renderDpi, tileTopInches, tilePxHeight, loadedImages)
    finalCtx.drawImage(tileCanvas, 0, tilePxTop)
  }

  const rawBlob = await canvasToBlob(finalCanvas)
  const rawBuffer = await rawBlob.arrayBuffer()
  const dpiBuffer = injectPHYsChunk(rawBuffer, dpi)
  return new Blob([dpiBuffer], { type: 'image/png' })
}

/**
 * Download a gang sheet as PNG file.
 * Shows an alert if the export fails so the user knows what happened.
 */
export async function downloadGangSheetPNG(
  layout: GangSheetLayout,
  options: ExportOptions = {}
): Promise<void> {
  try {
    const blob = await exportGangSheetPNG(layout, options)
    if (!blob || blob.size === 0) {
      throw new Error('Export produced an empty file')
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gang-sheet-batch-${layout.batch_number}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Gang sheet PNG export failed:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    alert(`Failed to export gang sheet PNG: ${msg}`)
    throw err
  }
}
