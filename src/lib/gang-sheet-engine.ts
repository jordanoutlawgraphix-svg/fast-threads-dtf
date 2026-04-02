// ============================================
// Gang Sheet Layout Engine
// ============================================
// Skyline bin-packing algorithm for arranging prints on a 28"-wide gang sheet.
// Places items at the lowest available position, naturally filling gaps.
// IMPORTANT: Artwork is NEVER rotated. DTF prints must stay in their
// original orientation so they print correctly on garments.

import { GangSheetConfig, DEFAULT_GANG_SHEET_CONFIG } from '@/types'

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
}

// ---- Skyline data structure ----
interface SkylineNode {
  x: number
  y: number
  width: number
}

// Find the best position on the skyline to place an item of given width.
// Picks lowest Y, then tightest fit, then leftmost X.
function findSkylinePosition(
  skyline: SkylineNode[],
  itemWidth: number,
  sheetWidth: number
): { x: number; y: number; startIdx: number; endIdx: number } | null {
  let bestY = Infinity
  let bestWaste = Infinity
  let bestX = Infinity
  let bestStart = -1
  let bestEnd = -1

  for (let i = 0; i < skyline.length; i++) {
    const startX = skyline[i].x
    if (startX + itemWidth > sheetWidth + 0.001) break

    let maxY = 0
    let spanWidth = 0
    let j = i
    while (j < skyline.length && spanWidth < itemWidth - 0.001) {
      maxY = Math.max(maxY, skyline[j].y)
      spanWidth += skyline[j].width
      j++
    }

    if (spanWidth >= itemWidth - 0.001) {
      const waste = spanWidth - itemWidth
      const isBetter =
        maxY < bestY - 0.001 ||
        (Math.abs(maxY - bestY) < 0.001 && waste < bestWaste - 0.001) ||
        (Math.abs(maxY - bestY) < 0.001 && Math.abs(waste - bestWaste) < 0.001 && startX < bestX)
      if (isBetter) {
        bestY = maxY
        bestWaste = waste
        bestX = startX
        bestStart = i
        bestEnd = j
      }
    }
  }

  if (bestStart < 0) return null
  return { x: bestX, y: bestY, startIdx: bestStart, endIdx: bestEnd }
}

// After placing an item, update the skyline by raising the covered segments.
function updateSkyline(
  skyline: SkylineNode[],
  pos: { x: number; y: number; startIdx: number; endIdx: number },
  itemWidth: number,
  itemHeight: number
): SkylineNode[] {
  const newY = pos.y + itemHeight
  const itemLeft = pos.x
  const itemRight = itemLeft + itemWidth
  const result: SkylineNode[] = []

  for (let i = 0; i < pos.startIdx; i++) {
    result.push({ ...skyline[i] })
  }

  const firstSeg = skyline[pos.startIdx]
  if (firstSeg.x < itemLeft - 0.001) {
    result.push({ x: firstSeg.x, y: firstSeg.y, width: itemLeft - firstSeg.x })
  }

  result.push({ x: itemLeft, y: newY, width: itemWidth })

  const lastIdx = pos.endIdx - 1
  const lastSeg = skyline[lastIdx]
  const lastSegEnd = lastSeg.x + lastSeg.width
  if (lastSegEnd > itemRight + 0.001) {
    result.push({ x: itemRight, y: lastSeg.y, width: lastSegEnd - itemRight })
  }

  for (let i = pos.endIdx; i < skyline.length; i++) {
    result.push({ ...skyline[i] })
  }

  // Merge adjacent segments with same Y
  const merged: SkylineNode[] = [result[0]]
  for (let k = 1; k < result.length; k++) {
    const prev = merged[merged.length - 1]
    if (Math.abs(prev.y - result[k].y) < 0.001) {
      prev.width += result[k].width
    } else {
      merged.push(result[k])
    }
  }

  return merged
}

/**
 * Simple shelf-based layout (kept as fallback for height estimation).
 */
export function layoutGangSheet(
  items: PrintItem[],
  batchNumber: number,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout {
  const { printable_width_inches, spacing_inches, batch_label_height_inches } = config
  const expandedItems: { item: PrintItem; copyIndex: number }[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ item, copyIndex: i })
    }
  }
  expandedItems.sort((a, b) => b.item.height_inches - a.item.height_inches)

  const placed: PlacedItem[] = []
  let placedIdCounter = 0
  let currentY = batch_label_height_inches + spacing_inches
  let currentX = spacing_inches
  let currentShelfHeight = 0

  for (const { item, copyIndex } of expandedItems) {
    const itemWidth = item.width_inches
    const itemHeight = item.height_inches
    if (currentX + itemWidth + spacing_inches > printable_width_inches) {
      currentY += currentShelfHeight + spacing_inches
      currentX = spacing_inches
      currentShelfHeight = 0
    }
    placed.push({
      id: `placed-${placedIdCounter++}`,
      item_id: item.id,
      x: currentX,
      y: currentY,
      width: itemWidth,
      height: itemHeight,
      label: item.label,
      invoice_number: item.invoice_number,
      copy_index: copyIndex,
    })
    currentX += itemWidth + spacing_inches
    currentShelfHeight = Math.max(currentShelfHeight, itemHeight)
  }

  const sheetHeight = currentY + currentShelfHeight + spacing_inches + batch_label_height_inches
  const totalPrintArea = placed.reduce((sum, p) => sum + p.width * p.height, 0)
  const sheetArea = printable_width_inches * sheetHeight
  const utilization = (totalPrintArea / sheetArea) * 100

  return {
    batch_number: batchNumber,
    placed_items: placed,
    sheet_width: printable_width_inches,
    sheet_height: Math.round(sheetHeight * 100) / 100,
    utilization_percent: Math.round(utilization * 10) / 10,
    total_items: placed.length,
  }
}

/**
 * Skyline bin-packing layout for gang sheets.
 *
 * Tracks the top edge (skyline) of placed content and drops each new
 * item into the lowest available position, naturally filling gaps.
 * Artwork is NEVER rotated - DTF prints must keep original orientation.
 *
 * Sort order: largest area first so big items get placed while the
 * skyline is still flat, then small items fill the remaining gaps.
 */
export function layoutGangSheetOptimized(
  items: PrintItem[],
  batchNumber: number,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout {
  const { printable_width_inches, spacing_inches, batch_label_height_inches } = config
  const usableWidth = printable_width_inches - 2 * spacing_inches

  // Expand items by quantity
  const expandedItems: { item: PrintItem; copyIndex: number }[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ item, copyIndex: i })
    }
  }

  // Sort: largest area first, then tallest, then widest
  expandedItems.sort((a, b) => {
    const areaA = a.item.width_inches * a.item.height_inches
    const areaB = b.item.width_inches * b.item.height_inches
    if (Math.abs(areaB - areaA) > 0.1) return areaB - areaA
    const hDiff = b.item.height_inches - a.item.height_inches
    if (Math.abs(hDiff) > 0.01) return hDiff
    return b.item.width_inches - a.item.width_inches
  })

  const placed: PlacedItem[] = []
  let placedIdCounter = 0

  // Initialize skyline: one flat segment spanning usable width
  const startY = batch_label_height_inches + spacing_inches
  let skyline: SkylineNode[] = [{ x: spacing_inches, y: startY, width: usableWidth }]

  for (const { item, copyIndex } of expandedItems) {
    const w = item.width_inches
    const h = item.height_inches

    // Find best position - NO rotation
    const pos = findSkylinePosition(skyline, w + spacing_inches, printable_width_inches)

    if (pos) {
      placed.push({
        id: `placed-${placedIdCounter++}`,
        item_id: item.id,
        x: pos.x,
        y: pos.y,
        width: w,
        height: h,
        label: item.label,
        invoice_number: item.invoice_number,
        copy_index: copyIndex,
      })

      skyline = updateSkyline(skyline, pos, w + spacing_inches, h + spacing_inches)
    }
  }

  // Sheet height = tallest point on skyline + bottom label
  const maxY = skyline.reduce((max, seg) => Math.max(max, seg.y), startY)
  const sheetHeight = maxY + batch_label_height_inches

  const totalPrintArea = placed.reduce((sum, p) => sum + p.width * p.height, 0)
  const sheetArea = printable_width_inches * sheetHeight
  const utilization = sheetArea > 0 ? (totalPrintArea / sheetArea) * 100 : 0

  return {
    batch_number: batchNumber,
    placed_items: placed,
    sheet_width: printable_width_inches,
    sheet_height: Math.round(sheetHeight * 100) / 100,
    utilization_percent: Math.round(utilization * 10) / 10,
    total_items: placed.length,
  }
}

/**
 * Split items into multiple gang sheets if they won't fit on one.
 */
export function createMultipleGangSheets(
  items: PrintItem[],
  startingBatchNumber: number,
  maxSheetHeightInches: number = 100,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout[] {
  const layouts: GangSheetLayout[] = []

  const expandedItems: PrintItem[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ ...item, quantity: 1, id: `${item.id}-copy-${i}` })
    }
  }
  expandedItems.sort((a, b) => b.height_inches - a.height_inches)

  let currentBatch: PrintItem[] = []
  let currentBatchNumber = startingBatchNumber

  for (const item of expandedItems) {
    currentBatch.push(item)
    const testLayout = layoutGangSheet(currentBatch, currentBatchNumber, config)
    if (testLayout.sheet_height > maxSheetHeightInches) {
      currentBatch.pop()
      if (currentBatch.length > 0) {
        layouts.push(layoutGangSheetOptimized(currentBatch, currentBatchNumber, config))
      }
      currentBatchNumber++
      currentBatch = [item]
    }
  }

  if (currentBatch.length > 0) {
    layouts.push(layoutGangSheetOptimized(currentBatch, currentBatchNumber, config))
  }

  return layouts
}
