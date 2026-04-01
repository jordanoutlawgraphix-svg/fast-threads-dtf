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
    if (currentX + itemWidth + spacing_inches > printable_width_inches) {      // Move to next shelf
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
 * Improved layout using shelf packing with gap-filling and per-item rotation.
 *
 * Algorithm:
 * 1. Sort items by height descending (best-fit decreasing)
 * 2. Place items on shelves left-to-right
 * 3. When a shelf has gaps (short items next to tall ones), attempt to fill
 *    the gap above shorter items with remaining unplaced items
 * 4. Try each item in both orientations (normal + 90° rotated) and pick *    whichever fits the available space with less waste
 */
export function layoutGangSheetOptimized(
  items: PrintItem[],
  batchNumber: number,
  config: GangSheetConfig = DEFAULT_GANG_SHEET_CONFIG
): GangSheetLayout {
  const { printable_width_inches, spacing_inches, batch_label_height_inches } = config

  // Expand items by quantity
  const expandedItems: { item: PrintItem; copyIndex: number; placed: boolean }[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ item, copyIndex: i, placed: false })
    }
  }

  // Sort by area descending (largest items first for better packing)
  expandedItems.sort((a, b) => {
    const areaA = a.item.width_inches * a.item.height_inches
    const areaB = b.item.width_inches * b.item.height_inches
    if (Math.abs(areaB - areaA) < 0.01) {
      // Tie-break: taller items first
      return b.item.height_inches - a.item.height_inches
    }
    return areaB - areaA
  })

  const placed: PlacedItem[] = []
  let placedIdCounter = 0

  // Shelf tracking
  interface Shelf {
    y: number           // top of shelf
    height: number      // shelf height (tallest item)
    nextX: number       // next available X position
    segments: { x: number; width: number; itemHeight: number }[] // track per-item heights for gap filling
  }

  const shelves: Shelf[] = []
  const startY = batch_label_height_inches + spacing_inches

  // Helper: try to place an item, considering rotation
  function bestFit(
    itemW: number, itemH: number, availW: number, availH: number
  ): { width: number; height: number; rotated: boolean } | null {
    const fitsNormal = itemW <= availW + 0.001 && (availH === 0 || itemH <= availH + 0.001)
    const fitsRotated = itemH <= availW + 0.001 && (availH === 0 || itemW <= availH + 0.001)

    if (fitsNormal && fitsRotated) {      // Pick orientation that wastes less width
      const wasteNormal = availW - itemW
      const wasteRotated = availW - itemH
      if (wasteNormal <= wasteRotated) {
        return { width: itemW, height: itemH, rotated: false }
      } else {
        return { width: itemH, height: itemW, rotated: true }
      }
    }
    if (fitsNormal) return { width: itemW, height: itemH, rotated: false }
    if (fitsRotated) return { width: itemH, height: itemW, rotated: true }
    return null
  }

  function placeOnSheet(entry: typeof expandedItems[0], x: number, y: number, w: number, h: number) {
    placed.push({
      id: `placed-${placedIdCounter++}`,
      item_id: entry.item.id,
      x, y,
      width: w,
      height: h,
      label: entry.item.label,
      invoice_number: entry.item.invoice_number,
      copy_index: entry.copyIndex,
    })
    entry.placed = true
  }

  // PASS 1: Place items onto shelves
  for (const entry of expandedItems) {
    if (entry.placed) continue

    const itemW = entry.item.width_inches
    const itemH = entry.item.height_inches

    let placedOnExistingShelf = false

    // Try to fit on the last shelf first (most common case)
    if (shelves.length > 0) {
      const shelf = shelves[shelves.length - 1]
      const availW = printable_width_inches - shelf.nextX - spacing_inches
      const fit = bestFit(itemW, itemH, availW, 0) // no height constraint for shelf items

      if (fit) {
        placeOnSheet(entry, shelf.nextX, shelf.y, fit.width, fit.height)
        shelf.segments.push({ x: shelf.nextX, width: fit.width, itemHeight: fit.height })
        shelf.nextX += fit.width + spacing_inches
        shelf.height = Math.max(shelf.height, fit.height)
        placedOnExistingShelf = true
      }
    }
    if (!placedOnExistingShelf) {
      // Start a new shelf
      const shelfY = shelves.length === 0
        ? startY
        : shelves[shelves.length - 1].y + shelves[shelves.length - 1].height + spacing_inches

      // Try rotation for the first item on the new shelf
      const fit = bestFit(itemW, itemH, printable_width_inches - 2 * spacing_inches, 0)
      if (fit) {
        const newShelf: Shelf = {
          y: shelfY,
          height: fit.height,
          nextX: spacing_inches + fit.width + spacing_inches,
          segments: [{ x: spacing_inches, width: fit.width, itemHeight: fit.height }],
        }
        shelves.push(newShelf)
        placeOnSheet(entry, spacing_inches, shelfY, fit.width, fit.height)
      }
    }
  }

  // PASS 2: Gap-fill — find unused space above short items on each shelf
  for (const shelf of shelves) {
    for (const seg of shelf.segments) {      const gapHeight = shelf.height - seg.itemHeight - spacing_inches
      if (gapHeight < 0.5) continue // gap too small to be useful

      const gapY = shelf.y + seg.itemHeight + spacing_inches
      const gapWidth = seg.width

      // Try to fit unplaced items into this gap
      for (const entry of expandedItems) {
        if (entry.placed) continue
        const fit = bestFit(
          entry.item.width_inches, entry.item.height_inches,
          gapWidth, gapHeight
        )
        if (fit) {
          placeOnSheet(entry, seg.x, gapY, fit.width, fit.height)
          break // one item per gap segment to keep it simple
        }
      }
    }
  }

  // Calculate total sheet height
  const lastShelf = shelves[shelves.length - 1]
  const sheetHeight = lastShelf
    ? lastShelf.y + lastShelf.height + spacing_inches + batch_label_height_inches    : startY + batch_label_height_inches

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