// ============================================
// Gang Sheet PNG Export
// ============================================
// Renders a GangSheetLayout (from gang-sheet-engine) to a transparent
// PNG suitable for DTF printing. The layout's `placements` array and
// loaded `images` are used directly so preview and export share a
// single source of placement truth.
//
// - Canvas is sized to sheet_width × used_height_inches at the config DPI.
// - Each placement is drawn via drawPlacementToCanvas, which blits the
//   trimmed source rect (trimBox) onto the sheet at the packed position.
// - Auto-scales render DPI down if the target height exceeds browser
//   canvas limits, then injects the ORIGINAL DPI into the PNG pHYs
//   chunk so the file opens at the correct physical size.

import { GangSheetLayout } from './gang-sheet-engine'
import { drawPlacementToCanvas, Placement } from './gang-sheet-packer'
import { GangSheetConfig, DEFAULT_GANG_SHEET_CONFIG } from '@/types'

interface ExportOptions {
  config?: GangSheetConfig
}

const MAX_CANVAS_HEIGHT = 16384

// ---- CRC32 for PNG chunk checksums ----
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
  view.setUint32(17, crc32(crcData), false)

  const ihdrEnd = 33
  const before = new Uint8Array(pngBuffer, 0, ihdrEnd)
  const after = new Uint8Array(pngBuffer, ihdrEnd)
  const result = new Uint8Array(before.length + chunk.length + after.length)
  result.set(before, 0)
  result.set(chunk, before.length)
  result.set(after, before.length + chunk.length)
  return result.buffer
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob && blob.size > 0) resolve(blob)
        else reject(new Error(
          `Canvas toBlob failed. Size: ${canvas.width}x${canvas.height}px. ` +
          `May exceed browser canvas limits.`,
        ))
      }, 'image/png')
    } catch (err) {
      reject(new Error(`Canvas toBlob threw: ${err}`))
    }
  })
}

/**
 * Draw a placeholder rect for a placement whose image did not load.
 * Drawn in the same coordinate space as drawPlacementToCanvas so
 * preview and export remain pixel-aligned.
 */
function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  placement: Placement,
  gutterPx: number,
) {
  const offset = gutterPx / 2
  const x = placement.x + offset
  const y = placement.y + offset
  const w = placement.rotated ? placement.drawHeight : placement.drawWidth
  const h = placement.rotated ? placement.drawWidth : placement.drawHeight
  ctx.fillStyle = 'rgba(229, 231, 235, 0.8)'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#9ca3af'
  ctx.lineWidth = 2
  ctx.strokeRect(x, y, w, h)
}

/**
 * Render a gang sheet layout to a PNG blob. Background is transparent
 * for DTF workflows — the RIP software manages the white ink layer.
 */
export async function exportGangSheetPNG(
  layout: GangSheetLayout,
  options: ExportOptions = {},
): Promise<Blob> {
  const config = options.config || DEFAULT_GANG_SHEET_CONFIG
  const dpi = config.dpi
  const sheetWidthInches = layout.sheet_width
  const sheetHeightInches = layout.used_height_inches
  if (sheetHeightInches <= 0) {
    throw new Error('Gang sheet has no packed items.')
  }

  // Scale DPI down if the canvas would exceed browser limits.
  let renderDpi = dpi
  let heightPx = Math.round(sheetHeightInches * renderDpi)
  if (heightPx > MAX_CANVAS_HEIGHT) {
    renderDpi = Math.floor(MAX_CANVAS_HEIGHT / sheetHeightInches)
    heightPx = Math.round(sheetHeightInches * renderDpi)
  }
  const widthPx = Math.round(sheetWidthInches * renderDpi)

  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas 2d context')
  ctx.clearRect(0, 0, widthPx, heightPx)

  // Scale the drawing context from inches → pixels so placements
  // (which are in inches) project directly onto the canvas.
  ctx.save()
  ctx.scale(renderDpi, renderDpi)
  // Quality settings for downscaled artwork.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  for (const placement of layout.placements) {
    const img = layout.images[placement.artworkId]
    if (img) {
      drawPlacementToCanvas(ctx, img, placement, layout.gutter_inches)
    } else {
      drawPlaceholder(ctx, placement, layout.gutter_inches)
    }
  }
  ctx.restore()

  const rawBlob = await canvasToBlob(canvas)
  const rawBuffer = await rawBlob.arrayBuffer()
  const dpiBuffer = injectPHYsChunk(rawBuffer, dpi)
  return new Blob([dpiBuffer], { type: 'image/png' })
}

export async function downloadGangSheetPNG(
  layout: GangSheetLayout,
  options: ExportOptions = {},
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
