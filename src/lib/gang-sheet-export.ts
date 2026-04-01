// ============================================
// Gang Sheet PNG Export
// ============================================
// Renders gang sheet layout to Canvas and exports as PNG.
// The exported PNG is transparent (no background) for DTF printing —
// the RIP software handles the white ink layer.
// Includes pHYs chunk injection for correct 300 DPI metadata.

import { GangSheetLayout } from './gang-sheet-engine'
import { GangSheetConfig, DEFAULT_GANG_SHEET_CONFIG } from '@/types'

interface ExportOptions {
  config?: GangSheetConfig
  /** If true, load and render actual print images. Otherwise render placeholder boxes. */
  renderImages?: boolean
  /** Map of item_id -> image URL for rendering actual artwork */
  imageUrls?: Record<string, string>
}

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
 * HTML Canvas toBlob() does NOT include DPI info, so PNGs default
 * to 72 DPI in most software. This makes a 28" x 300DPI = 8400px
 * image appear as 116" wide (8400/72). We fix that here.
 *
 * 300 DPI = 11811 pixels per meter (300 / 0.0254)
 */
function injectPHYsChunk(pngBuffer: ArrayBuffer, dpi: number): ArrayBuffer {
  const pixelsPerMeter = Math.round(dpi / 0.0254)

  // pHYs chunk: 4(length) + 4(type) + 9(data) + 4(crc) = 21 bytes
  const chunk = new Uint8Array(21)
  const view = new DataView(chunk.buffer)

  // Data length: 9 bytes
  view.setUint32(0, 9, false)

  // Chunk type: "pHYs"
  chunk[4] = 0x70 // p
  chunk[5] = 0x48 // H
  chunk[6] = 0x59 // Y
  chunk[7] = 0x73 // s

  // X pixels per unit
  view.setUint32(8, pixelsPerMeter, false)

  // Y pixels per unit
  view.setUint32(12, pixelsPerMeter, false)

  // Unit specifier: 1 = meter
  chunk[16] = 1

  // CRC32 over type + data (bytes 4 through 16, inclusive = 13 bytes)
  const crcData = chunk.slice(4, 17)
  const crcValue = crc32(crcData)
  view.setUint32(17, crcValue, false)

  // Insert pHYs chunk right after IHDR chunk
  // PNG file: 8-byte signature + IHDR (4+4+13+4 = 25 bytes) = 33 bytes total
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
 * Render a gang sheet layout to a PNG blob.
 * Uses an offscreen canvas at the configured DPI.
 * Background is TRANSPARENT for DTF — the RIP software adds the white ink layer.
 * PNG includes pHYs metadata so it opens at correct physical dimensions (28" wide).
 */
export async function exportGangSheetPNG(
  layout: GangSheetLayout,
  options: ExportOptions = {}
): Promise<Blob> {
  const config = options.config || DEFAULT_GANG_SHEET_CONFIG
  const dpi = config.dpi
  const renderImages = options.renderImages ?? false
  const imageUrls = options.imageUrls || {}

  // Calculate pixel dimensions — trim batch label areas from top and bottom
  // The layout engine adds label padding, but the exported PNG is just artwork
  const labelHeight = config.batch_label_height_inches
  const trimmedHeight = layout.sheet_height - (labelHeight * 2)
  const widthPx = Math.round(layout.sheet_width * dpi)
  const heightPx = Math.round(trimmedHeight * dpi)
  const yOffset = labelHeight

  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas 2d context')

  // FORCE transparent — clearRect sets all pixels to rgba(0,0,0,0)
  // Do NOT fill with white. DTF RIP software handles white ink layer.
  ctx.clearRect(0, 0, widthPx, heightPx)

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

  // Draw each placed item — artwork only, no borders or labels
  for (const item of layout.placed_items) {
    const x = Math.round(item.x * dpi)
    const y = Math.round((item.y - yOffset) * dpi)
    const w = Math.round(item.width * dpi)
    const h = Math.round(item.height * dpi)

    const img = loadedImages[item.item_id]
    if (img) {
      // Draw actual artwork scaled to fit
      ctx.drawImage(img, x, y, w, h)
    } else {
      // Placeholder box — semi-transparent so it's obvious if images failed
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

  // Convert canvas to PNG blob
  const rawBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to export canvas to PNG'))
      },
      'image/png'
    )
  })

  // Inject pHYs chunk so the PNG opens at correct physical size
  // Without this, 8400px defaults to 72 DPI = 116" wide instead of 28"
  const rawBuffer = await rawBlob.arrayBuffer()
  const dpiBuffer = injectPHYsChunk(rawBuffer, dpi)
  return new Blob([dpiBuffer], { type: 'image/png' })
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
