// ============================================
// Gang Sheet Layout Engine
// ============================================
// Skyline bin-packing algorithm for arranging prints on a 28"-wide gang sheet.
// Places items at the lowest available position, naturally filling gaps.

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
// The skyline is a list of horizontal segments representing the top edge
// of already-placed content. Each node: { x, y, width }
// Items are placed at the lowest available position on the skyline.
interface SkylineNode {
  x: number  // left edge of segment
  y: number  // height (top edge) of segment
  width: number  // width of segment
}

// Find the best position on the skyline to place an item of given width.
// Returns the position with the lowest Y (ties broken by leftmost X).
function findSkylinePosition(
  skyline: SkylineNode[],
  itemWidth: number,
  sheetWidth: number
): { x: number; y: number; startIdx: number; endIdx: number } | null {
  let bestY = Infinity
  let bestX = Infinity
  let bestStart = -1
  let bestEnd = -1

  for (let i = 0; i < skyline.length; i++) {
    const startX = skyline[i].x
    if (startX + itemWidth > sheetWidth + 0.001) break

    // Find the max Y across all segments this item would span
    let maxY = 0
    let spanWidth = 0
    let j = i
    while (j < skyline.length && spanWidth < itemWidth - 0.001) {
      maxY = Math.max(maxY, skyline[j].y)
      spanWidth += skyline[j].width
      j++
    }

    if (spanWidth >= itemWidth - 0.001) {
      if (maxY < bestY || (Math.abs(maxY - bestY) < 0.001 && startX < bestX)) {
        bestY = maxY
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

  // Keep segments entirely before the item
  for (let i = 0; i < pos.startIdx; i++) {
    result.push({ ...skyline[i] })
  }

  // Handle left remainder of first covered segment
  const firstSeg = skyline[pos.startIdx]
  if (firstSeg.x < itemLeft - 0.001) {
    result.push({ x: firstSeg.x, y: firstSeg.y, width: itemLeft - firstSeg.x })
  }

  // New raised segment for the placed item
  result.push({ x: itemLeft, y: newY, width: itemWidth })

  // Handle right remainder of last covered segment
  const lastIdx = pos.endIdx - 1
  const lastSeg = skyline[lastIdx]
  const lastSegEnd = lastSeg.x + lastSeg.width
  if (lastSegEnd > itemRight + 0.001) {
    result.push({ x: itemRight, y: lastSeg.y, width: lastSegEnd - itemRight })
  }

  // Keep segments entirely after the item
  for (let i = pos.endIdx; i < skyline.length; i++) {
    result.push({ ...skyline[i] })
  }

  // Merge adjacent segments with the same Y
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
 * Simple shelf-based layout (kept as fallback).
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
 * Instead of rows/shelves, this tracks the actual top edge (skyline) of
 * all placed content and drops each new item into the lowest available
 * position. Items naturally fill gaps — like Tetris.
 *
 * Each item is tried in both orientations (normal + 90 rotated) and the
 * orientation producing the lower placement wins.
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

  // Sort by height descending — taller items first creates flatter skylines
  expandedItems.sort((a, b) => {
    const hDiff = b.item.height_inches - a.item.height_inches
    if (Math.abs(hDiff) > 0.01) return hDiff
    return (b.item.width_inches * b.item.height_inches) - (a.item.width_inches * a.item.height_inches)
  })

  const placed: PlacedItem[] = []
  let placedIdCounter = 0

  // Initialize skyline: one flat segment spanning usable width
  // The Y starts after the batch label area
  const startY = batch_label_height_inches + spacing_inches
  let skyline: SkylineNode[] = [{ x: spacing_inches, y: startY, width: usableWidth }]

  for (const { item, copyIndex } of expandedItems) {
    const w = item.width_inches
    const h = item.height_inches

    // Try normal orientation
    const posNormal = findSkylinePosition(skyline, w + spacing_inches, printable_width_inches)
    // Try rotated orientation
    const posRotated = findSkylinePosition(skyline, h + spacing_inches, printable_width_inches)

    let useRotated = false
    let pos: { x: number; y: number; startIdx: number; endIdx: number } | null = null
    let finalW = w
    let finalH = h

    if (posNormal && posRotated) {
      // Pick whichever results in the lower top edge after placement
      const topNormal = posNormal.y + h
      const topRotated = posRotated.y + w
      if (topRotated < topNormal - 0.001) {
        useRotated = true
        pos = posRotated
        finalW = h
        finalH = w
      } else {
        pos = posNormal
      }
    } else if (posNormal) {
      pos = posNormal
    } else if (posRotated) {
      useRotated = true
      pos = posRotated
      finalW = h
      finalH = w
    }

    if (pos) {
      placed.push({
        id: `placed-${placedIdCounter++}`,
        item_id: item.id,
        x: pos.x,
        y: pos.y,
        width: finalW,
        height: finalH,
        label: item.label,
        invoice_number: item.invoice_number,
        copy_index: copyIndex,
      })

      // Update skyline with the placed item (include spacing in height)
      skyline = updateSkyline(skyline, pos, finalW + spacing_inches, finalH + spacing_inches)
    }
  }

  // Calculate total sheet height from skyline max Y
  const maxY = skyline.reduce((max, seg) => Math.max(max, seg.y), startY)
  const sheetHeight = maxY + batch_label_height_inches

  // Calculate utilization
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
