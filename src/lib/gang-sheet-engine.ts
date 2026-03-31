// ============================================
// Gang Sheet Layout Engine
// ============================================
// Bin-packing algorithm for arranging prints on a 28"-wide gang sheet.
// Uses a shelf-based best-fit decreasing algorithm optimized for DTF.

import { GangSheetConfig, DEFAULT_GANG_SHEET_CONFIG } from '@/types'

export interface PrintItem {
  id: string
  width_inches: number
  height_inches: number
  quantity: number
  label: string // e.g., "INV-1234 | Left Chest | Adult x12"
  invoice_number: string
  thumbnail_url?: string
}

export interface PlacedItem {
  id: string
  item_id: string
  x: number // inches from left edge
  y: number // inches from top
  width: number
  height: number
  label: string
  invoice_number: string
  copy_index: number // which copy this is (0-based)
}

export interface GangSheetLayout {
  batch_number: number
  placed_items: PlacedItem[]
  sheet_width: number
  sheet_height: number // calculated based on content
  utilization_percent: number // how much of the sheet is used
  total_items: number
}

/**
 * Layout items onto a gang sheet using shelf-based bin packing.
 * Each "shelf" is a horizontal row. Items are placed left-to-right,
 * and when a row is full, a new shelf starts below.
 */
export function layoutGangSheet(
  items: PrintItem[],
  batchNumber: number,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout {
  const { printable_width_inches, spacing_inches, batch_label_height_inches } = config

  // Expand items by quantity - each copy gets its own placement
  const expandedItems: { item: PrintItem; copyIndex: number }[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ item, copyIndex: i })
    }
  }

  // Sort by height descending (best-fit decreasing for shelf packing)
  expandedItems.sort((a, b) => b.item.height_inches - a.item.height_inches)

  const placed: PlacedItem[] = []
  let placedIdCounter = 0

  // Start with space for "START BATCH X" label
  let currentY = batch_label_height_inches + spacing_inches
  let currentX = spacing_inches
  let currentShelfHeight = 0

  for (const { item, copyIndex } of expandedItems) {
    const itemWidth = item.width_inches
    const itemHeight = item.height_inches

    // Can this item fit on the current shelf?
    if (currentX + itemWidth + spacing_inches > printable_width_inches) {
      // Move to next shelf
      currentY += currentShelfHeight + spacing_inches
      currentX = spacing_inches
      currentShelfHeight = 0
    }

    // Place the item
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

  // Calculate total sheet height (include end label)
  const sheetHeight = currentY + currentShelfHeight + spacing_inches + batch_label_height_inches

  // Calculate utilization
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
 * Improved layout using Next-Fit Decreasing Height with rotation consideration.
 * Tries placing items in both orientations to find better packing.
 */
export function layoutGangSheetOptimized(
  items: PrintItem[],
  batchNumber: number,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout {
  // Try the standard layout
  const standardLayout = layoutGangSheet(items, batchNumber, config)

  // Try with wider items rotated 90°
  const rotatedItems = items.map(item => {
    // Only rotate if the item is wider than tall and rotation would help
    if (item.width_inches > item.height_inches) {
      return {
        ...item,
        width_inches: item.height_inches,
        height_inches: item.width_inches,
      }
    }
    return item
  })

  const rotatedLayout = layoutGangSheet(rotatedItems, batchNumber, config)

  // Return the one with better utilization
  return rotatedLayout.utilization_percent > standardLayout.utilization_percent
    ? rotatedLayout
    : standardLayout
}

/**
 * Split items into multiple gang sheets if they won't fit on one.
 * Returns multiple layouts.
 */
export function createMultipleGangSheets(
  items: PrintItem[],
  startingBatchNumber: number,
  maxSheetHeightInches: number = 100, // reasonable max length for a single sheet
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout[] {
  const layouts: GangSheetLayout[] = []

  // Expand all items
  const expandedItems: PrintItem[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ ...item, quantity: 1, id: `${item.id}-copy-${i}` })
    }
  }

  // Sort by height descending
  expandedItems.sort((a, b) => b.height_inches - a.height_inches)

  let currentBatch: PrintItem[] = []
  let currentBatchNumber = startingBatchNumber

  for (const item of expandedItems) {
    currentBatch.push(item)

    // Check if current batch fits
    const testLayout = layoutGangSheet(currentBatch, currentBatchNumber, config)
    if (testLayout.sheet_height > maxSheetHeightInches) {
      // Remove last item, finalize this sheet
      currentBatch.pop()
      if (currentBatch.length > 0) {
        layouts.push(layoutGangSheetOptimized(currentBatch, currentBatchNumber, config))
      }
      currentBatchNumber++
      currentBatch = [item]
    }
  }

  // Finalize remaining items
  if (currentBatch.length > 0) {
    layouts.push(layoutGangSheetOptimized(currentBatch, currentBatchNumber, config))
  }

  return layouts
}
