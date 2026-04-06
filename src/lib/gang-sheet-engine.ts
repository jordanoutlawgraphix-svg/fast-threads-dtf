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
// Strategy: find the lowest Y where the item fits, breaking ties by
// least wasted space, then leftmost X.
function findSkylinePosition(
  skyline: SkylineNode[],
  itemWidth: number,
  maxRight: number
): { x: number; y: number; startIdx: number; endIdx: number } | null {
  let bestY = Infinity
  let bestWaste = Infinity
  let bestX = Infinity
  let bestStart = -1
  let bestEnd = -1

  for (let i = 0; i < skyline.length; i++) {
    const startX = skyline[i].x
    // If this segment starts too far right, no room for item
    if (startX + itemWidth > maxRight + 0.001) break

    // Span across segments to cover itemWidth
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

// After placing an item, update the skyline by raising covered segments.
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

  // Keep segments before the affected range
  for (let i = 0; i < pos.startIdx; i++) {
    result.push({ ...skyline[i] })
  }

  // Left remainder of the first affected segment
  const firstSeg = skyline[pos.startIdx]
  if (firstSeg.x < itemLeft - 0.001) {
    result.push({ x: firstSeg.x, y: firstSeg.y, width: itemLeft - firstSeg.x })
  }

  // New raised segment for the item
  result.push({ x: itemLeft, y: newY, width: itemWidth })

  // Right remainder of the last affected segment
  const lastIdx = pos.endIdx - 1
  const lastSeg = skyline[lastIdx]
  const lastSegEnd = lastSeg.x + lastSeg.width
  if (lastSegEnd > itemRight + 0.001) {
    result.push({ x: itemRight, y: lastSeg.y, width: lastSegEnd - itemRight })
  }

  // Keep segments after the affected range
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
 * Run skyline bin-packing with a given sort order of items.
 * Returns the placed items array and the max Y reached.
 */
function runSkylinePacking(
  expandedItems: { item: PrintItem; copyIndex: number }[],
  config: GangSheetConfig
): { placed: PlacedItem[]; maxY: number } {
  const { printable_width_inches, spacing_inches, batch_label_height_inches } = config
  const usableWidth = printable_width_inches - 2 * spacing_inches
  const maxRight = printable_width_inches - spacing_inches

  const placed: PlacedItem[] = []
  let placedIdCounter = 0
  const startY = batch_label_height_inches + spacing_inches
  let skyline: SkylineNode[] = [{ x: spacing_inches, y: startY, width: usableWidth }]

  for (const { item, copyIndex } of expandedItems) {
    const w = item.width_inches
    const h = item.height_inches

    // Search for position — item needs w width, plus spacing gap after it
    // But if the item touches the right margin, no trailing gap needed
    const searchWidth = w + spacing_inches
    const pos = findSkylinePosition(skyline, searchWidth, maxRight + spacing_inches)

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

      // Update skyline: the occupied region includes spacing
      skyline = updateSkyline(skyline, pos, searchWidth, h + spacing_inches)
    }
  }

  const maxY = skyline.reduce((max, seg) => Math.max(max, seg.y), startY)
  return { placed, maxY }
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
 * Tries multiple sort strategies and picks the one that produces
 * the shortest (most compact) sheet. This compensates for the fact
 * that no single sort order is optimal for all item mixes.
 *
 * Artwork is NEVER rotated — DTF prints must keep original orientation.
 */
export function layoutGangSheetOptimized(
  items: PrintItem[],
  batchNumber: number,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout {
  const { printable_width_inches, batch_label_height_inches } = config

  // Expand items by quantity
  const expandedItems: { item: PrintItem; copyIndex: number }[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ item, copyIndex: i })
    }
  }

  // Try multiple sort strategies — different orderings pack differently
  const strategies: { item: PrintItem; copyIndex: number }[][] = []

  // Strategy 1: Sort by height descending (classic shelf approach)
  const byHeight = [...expandedItems].sort((a, b) => {
    const hd = b.item.height_inches - a.item.height_inches
    if (Math.abs(hd) > 0.01) return hd
    return b.item.width_inches - a.item.width_inches
  })
  strategies.push(byHeight)

  // Strategy 2: Sort by width descending (fills horizontal space first)
  const byWidth = [...expandedItems].sort((a, b) => {
    const wd = b.item.width_inches - a.item.width_inches
    if (Math.abs(wd) > 0.01) return wd
    return b.item.height_inches - a.item.height_inches
  })
  strategies.push(byWidth)

  // Strategy 3: Sort by area descending (original approach)
  const byArea = [...expandedItems].sort((a, b) => {
    const aa = a.item.width_inches * a.item.height_inches
    const ab = b.item.width_inches * b.item.height_inches
    if (Math.abs(ab - aa) > 0.1) return ab - aa
    return b.item.height_inches - a.item.height_inches
  })
  strategies.push(byArea)

  // Strategy 4: Group by similar width, then sort by height within groups
  // This clusters same-width items into efficient rows
  const byWidthGroup = [...expandedItems].sort((a, b) => {
    // Round widths to nearest 0.5" to create groups
    const gA = Math.round(a.item.width_inches * 2) / 2
    const gB = Math.round(b.item.width_inches * 2) / 2
    if (Math.abs(gB - gA) > 0.01) return gB - gA
    return b.item.height_inches - a.item.height_inches
  })
  strategies.push(byWidthGroup)

  // Strategy 5: Sort by max dimension descending
  const byMaxDim = [...expandedItems].sort((a, b) => {
    const mA = Math.max(a.item.width_inches, a.item.height_inches)
    const mB = Math.max(b.item.width_inches, b.item.height_inches)
    if (Math.abs(mB - mA) > 0.01) return mB - mA
    return b.item.width_inches * b.item.height_inches - a.item.width_inches * a.item.height_inches
  })
  strategies.push(byMaxDim)

  // Run all strategies and pick the one with smallest maxY (shortest sheet)
  let bestPlaced: PlacedItem[] = []
  let bestMaxY = Infinity

  for (const sortedItems of strategies) {
    const result = runSkylinePacking(sortedItems, config)
    if (result.placed.length === expandedItems.length && result.maxY < bestMaxY) {
      bestMaxY = result.maxY
      bestPlaced = result.placed
    }
  }

  // Fallback: if no strategy placed everything, use first strategy result
  if (bestPlaced.length === 0) {
    const fallback = runSkylinePacking(strategies[0], config)
    bestPlaced = fallback.placed
    bestMaxY = fallback.maxY
  }

  const sheetHeight = bestMaxY + batch_label_height_inches
  const totalPrintArea = bestPlaced.reduce((sum, p) => sum + p.width * p.height, 0)
  const sheetArea = printable_width_inches * sheetHeight
  const utilization = sheetArea > 0 ? (totalPrintArea / sheetArea) * 100 : 0

  return {
    batch_number: batchNumber,
    placed_items: bestPlaced,
    sheet_width: printable_width_inches,
    sheet_height: Math.round(sheetHeight * 100) / 100,
    utilization_percent: Math.round(utilization * 10) / 10,
    total_items: bestPlaced.length,
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
