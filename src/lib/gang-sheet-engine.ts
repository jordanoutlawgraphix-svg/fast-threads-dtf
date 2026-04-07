// ============================================
// Gang Sheet Layout Engine
// ============================================
// Row-based shelf packing for arranging prints on a 28"-wide gang sheet.
// Groups items by similar height, then packs each group into clean rows
// left-to-right. This produces organized, easy-to-verify layouts for
// DTF production.
//
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

interface ExpandedItem {
  item: PrintItem
  copyIndex: number
}

/**
 * Pack expanded items into clean rows on a sheet of given width.
 * Items go left-to-right. When a row is full, start a new row.
 * Row height = tallest item in that row + spacing.
 */
function packIntoRows(
  items: ExpandedItem[],
  sheetWidth: number,
  spacing: number,
  startY: number
): { placed: PlacedItem[]; maxY: number } {
  const placed: PlacedItem[] = []
  let placedId = 0
  let currentX = spacing
  let currentY = startY
  let rowHeight = 0

  for (const { item, copyIndex } of items) {
    const w = item.width_inches
    const h = item.height_inches

    // If item doesn't fit in current row, start a new row
    if (currentX + w + spacing > sheetWidth && currentX > spacing + 0.001) {
      currentY += rowHeight + spacing
      currentX = spacing
      rowHeight = 0
    }

    placed.push({
      id: `placed-${placedId++}`,
      item_id: item.id,
      x: currentX,
      y: currentY,
      width: w,
      height: h,
      label: item.label,
      invoice_number: item.invoice_number,
      copy_index: copyIndex,
    })

    currentX += w + spacing
    rowHeight = Math.max(rowHeight, h)
  }

  const maxY = currentY + rowHeight + spacing
  return { placed, maxY }
}

/**
 * Simple shelf-based layout (kept for height estimation and multi-sheet splitting).
 */
export function layoutGangSheet(
  items: PrintItem[],
  batchNumber: number,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout {
  const { printable_width_inches, spacing_inches, batch_label_height_inches } = config

  const expandedItems: ExpandedItem[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ item, copyIndex: i })
    }
  }
  // Sort tallest first so rows are efficient
  expandedItems.sort((a, b) => b.item.height_inches - a.item.height_inches)

  const startY = batch_label_height_inches + spacing_inches
  const { placed, maxY } = packIntoRows(expandedItems, printable_width_inches, spacing_inches, startY)

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
 * Optimized row-based layout for gang sheets.
 *
 * Strategy:
 * 1. Expand all items by quantity into individual copies
 * 2. Group copies by similar height (within 1" tolerance)
 * 3. Within each group, sort widest-first for better row packing
 * 4. Pack groups into clean horizontal rows, tallest groups first
 *
 * This produces organized rows where items in each row are close
 * to the same height, minimizing wasted vertical space. The layout
 * is clean and easy for operators to verify during production.
 *
 * Artwork is NEVER rotated.
 */
export function layoutGangSheetOptimized(
  items: PrintItem[],
  batchNumber: number,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout {
  const { printable_width_inches, spacing_inches, batch_label_height_inches } = config

  // Expand items by quantity into individual copies
  const expandedItems: ExpandedItem[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ item, copyIndex: i })
    }
  }

  // Group by similar height — items within 1" of each other go together.
  // This keeps rows clean with minimal wasted vertical space.
  const heightTolerance = 1.0
  expandedItems.sort((a, b) => b.item.height_inches - a.item.height_inches)

  const groups: ExpandedItem[][] = []
  let currentGroup: ExpandedItem[] = []
  let groupMaxHeight = 0

  for (const ei of expandedItems) {
    const h = ei.item.height_inches
    if (currentGroup.length === 0) {
      currentGroup.push(ei)
      groupMaxHeight = h
    } else if (groupMaxHeight - h <= heightTolerance) {
      currentGroup.push(ei)
    } else {
      groups.push(currentGroup)
      currentGroup = [ei]
      groupMaxHeight = h
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  // Within each group, sort widest-first for better row utilization
  for (const group of groups) {
    group.sort((a, b) => b.item.width_inches - a.item.width_inches)
  }

  // Flatten groups back into sorted order: tallest groups first,
  // widest items first within each group
  const sortedItems: ExpandedItem[] = []
  for (const group of groups) {
    for (const ei of group) {
      sortedItems.push(ei)
    }
  }

  // Pack into clean rows
  const startY = batch_label_height_inches + spacing_inches
  const { placed, maxY } = packIntoRows(sortedItems, printable_width_inches, spacing_inches, startY)

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
