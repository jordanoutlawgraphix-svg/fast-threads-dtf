// ============================================
// Gang Sheet Layout Engine
// ============================================
// Adapter over the MaxRects packer in gang-sheet-packer.ts.
//
// Pipeline:
//   1. Load each unique artwork image (browser only).
//   2. Compute trimmed alpha bounds in source-image pixels (trimBox).
//   3. Derive the final printed size from the TRIMMED aspect ratio,
//      constrained by the user's requested width/height.
//   4. Expand per-quantity copies and hand them to packGangSheets
//      (MaxRects best short side fit, no rotation for DTF).
//   5. Return a layout that carries both legacy inch-coordinates
//      (for the on-screen summary) and raw placements + loaded images
//      (for the PNG exporter, so preview + export share one source
//      of placement truth).

import { GangSheetConfig, DEFAULT_GANG_SHEET_CONFIG } from '@/types'
import {
  ArtworkInput,
  PackOptions,
  Placement,
  packGangSheetsBestOf,
  resolveTargetSize,
  trimAlphaBoundsRGBA,
} from './gang-sheet-packer'

export interface PrintItem {
  id: string
  width_inches: number
  height_inches: number
  quantity: number
  label: string
  invoice_number: string
  thumbnail_url?: string
}

export interface PlacedItem {
  id: string
  item_id: string
  x: number
  y: number
  width: number
  height: number
  label: string
  invoice_number: string
  copy_index: number
}

export interface GangSheetLayout {
  batch_number: number
  placed_items: PlacedItem[]
  sheet_width: number
  sheet_height: number
  utilization_percent: number
  total_items: number
  // Packer output — export uses these directly so preview and PNG
  // render from the exact same placement data.
  placements: Placement[]
  gutter_inches: number
  used_height_inches: number
  images: Record<string, HTMLImageElement>
}

interface TrimmedArtwork {
  image: HTMLImageElement
  trimBox: { x: number; y: number; width: number; height: number }
  sourceWidth: number
  sourceHeight: number
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

async function trimArtwork(url: string): Promise<TrimmedArtwork> {
  const image = await loadImage(url)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height

  // Read pixels off-screen so we can compute tight alpha bounds.
  const canvas = document.createElement('canvas')
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      image,
      sourceWidth,
      sourceHeight,
      trimBox: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
    }
  }
  ctx.clearRect(0, 0, sourceWidth, sourceHeight)
  ctx.drawImage(image, 0, 0)
  let trimBox
  try {
    const data = ctx.getImageData(0, 0, sourceWidth, sourceHeight).data
    trimBox = trimAlphaBoundsRGBA(data, sourceWidth, sourceHeight)
  } catch {
    // Cross-origin taint — fall back to full image bounds.
    trimBox = { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
  }
  return { image, trimBox, sourceWidth, sourceHeight }
}

/**
 * Build a gang sheet layout from print items + their source image URLs.
 *
 * - Trims transparent alpha from each source image (cached once per unique id).
 * - Resolves each item's print size from the TRIMMED aspect ratio so the
 *   user's requested dimensions always match the real artwork proportions.
 * - Expands per-quantity copies, then packs them with MaxRects BSSF.
 * - Does NOT explicitly group copies of the same design — packer decides
 *   placement purely on fit, so duplicates are free to interleave.
 * - Rotation is disabled (DTF prints must stay upright).
 */
export async function layoutGangSheetOptimized(
  items: PrintItem[],
  batchNumber: number,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG,
  imageUrls: Record<string, string> = {},
): Promise<GangSheetLayout> {
  const { printable_width_inches, spacing_inches, batch_label_height_inches } = config

  // Trim every unique source image once.
  const uniqueItems = new Map<string, PrintItem>()
  for (const item of items) uniqueItems.set(item.id, item)

  const trimmed: Record<string, TrimmedArtwork> = {}
  const images: Record<string, HTMLImageElement> = {}
  await Promise.all(
    Array.from(uniqueItems.keys()).map(async (id) => {
      const url = imageUrls[id]
      if (!url) return
      try {
        const t = await trimArtwork(url)
        trimmed[id] = t
        images[id] = t.image
      } catch (err) {
        console.warn(`Trim failed for ${id}:`, err)
      }
    }),
  )

  // Build ArtworkInput[] for the packer using trimmed aspect ratios.
  const artworks: ArtworkInput[] = []
  for (const item of items) {
    const t = trimmed[item.id]
    if (t) {
      const target = resolveTargetSize(
        t.trimBox.width,
        t.trimBox.height,
        item.width_inches,
        item.height_inches,
      )
      artworks.push({
        id: item.id,
        quantity: item.quantity,
        sourceWidth: t.sourceWidth,
        sourceHeight: t.sourceHeight,
        trimBox: t.trimBox,
        targetWidth: target.width,
        targetHeight: target.height,
        allowRotate: false,
        meta: { label: item.label, invoice_number: item.invoice_number },
      })
    } else {
      // No image available — fall back to user dimensions with a synthetic
      // full-frame trimBox so the item still packs and renders a placeholder.
      artworks.push({
        id: item.id,
        quantity: item.quantity,
        sourceWidth: Math.max(1, Math.round(item.width_inches * 300)),
        sourceHeight: Math.max(1, Math.round(item.height_inches * 300)),
        trimBox: {
          x: 0,
          y: 0,
          width: Math.max(1, Math.round(item.width_inches * 300)),
          height: Math.max(1, Math.round(item.height_inches * 300)),
        },
        targetWidth: item.width_inches,
        targetHeight: item.height_inches,
        allowRotate: false,
        meta: { label: item.label, invoice_number: item.invoice_number },
      })
    }
  }

  const packOptions: PackOptions = {
    sheetWidth: printable_width_inches,
    maxSheetHeight: 200, // generous upper bound in inches for a single sheet
    gutter: spacing_inches,
    edgePadding: 0,
    allowGlobalRotate: false,
  }

  const sheets = packGangSheetsBestOf(artworks, packOptions)
  const sheet = sheets[0] ?? {
    index: 0,
    width: printable_width_inches,
    height: 0,
    usedHeight: 0,
    placements: [] as Placement[],
  }

  // Map placements → legacy inch-coordinate PlacedItem[] for the summary view.
  // drawX/Y inside a pack rect is (x + gutter/2, y + gutter/2) and the
  // on-sheet size is drawWidth/drawHeight swapped iff rotated.
  const placed: PlacedItem[] = sheet.placements.map((p, idx) => {
    const drawnW = p.rotated ? p.drawHeight : p.drawWidth
    const drawnH = p.rotated ? p.drawWidth : p.drawHeight
    const meta = (p.meta || {}) as { label?: string; invoice_number?: string }
    return {
      id: `placed-${idx}`,
      item_id: p.artworkId,
      x: p.x + spacing_inches / 2,
      y: p.y + spacing_inches / 2,
      width: drawnW,
      height: drawnH,
      label: meta.label ?? '',
      invoice_number: meta.invoice_number ?? '',
      copy_index: idx,
    }
  })

  // Export uses usedHeight as the final sheet height. The on-screen summary
  // adds the batch label area at top + bottom for operator readability.
  const usedHeight = sheet.usedHeight
  const sheetHeight = usedHeight + batch_label_height_inches * 2

  const totalPrintArea = placed.reduce((sum, p) => sum + p.width * p.height, 0)
  const sheetArea = printable_width_inches * Math.max(sheetHeight, 0.001)
  const utilization = sheetArea > 0 ? (totalPrintArea / sheetArea) * 100 : 0

  return {
    batch_number: batchNumber,
    placed_items: placed,
    sheet_width: printable_width_inches,
    sheet_height: Math.round(sheetHeight * 100) / 100,
    utilization_percent: Math.round(utilization * 10) / 10,
    total_items: placed.length,
    placements: sheet.placements,
    gutter_inches: spacing_inches,
    used_height_inches: usedHeight,
    images,
  }
}
