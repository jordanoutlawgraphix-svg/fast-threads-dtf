export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type Size = {
  width: number
  height: number
}

export interface ArtworkInput {
  id: string
  quantity: number
  sourceWidth: number
  sourceHeight: number
  trimBox: Rect
  targetWidth: number
  targetHeight: number
  allowRotate?: boolean
  meta?: Record<string, unknown>
}

export interface PackOptions {
  sheetWidth: number
  maxSheetHeight: number
  gutter: number
  edgePadding?: number
  allowGlobalRotate?: boolean
}

export interface ExpandedCopy {
  uid: string
  artworkId: string
  drawWidth: number
  drawHeight: number
  packWidth: number
  packHeight: number
  allowRotate: boolean
  trimBox: Rect
  sourceWidth: number
  sourceHeight: number
  meta?: Record<string, unknown>
}

export interface Placement extends ExpandedCopy {
  sheetIndex: number
  x: number
  y: number
  width: number
  height: number
  rotated: boolean
}

export interface PackedSheet {
  index: number
  width: number
  height: number
  usedHeight: number
  placements: Placement[]
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    b.x >= a.x + a.width ||
    b.x + b.width <= a.x ||
    b.y >= a.y + a.height ||
    b.y + b.height <= a.y
  )
}

function isContainedIn(a: Rect, b: Rect): boolean {
  return (
    a.x >= b.x &&
    a.y >= b.y &&
    a.x + a.width <= b.x + b.width &&
    a.y + a.height <= b.y + b.height
  )
}

function roundPx(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function trimAlphaBoundsRGBA(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 8,
): Rect {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3]
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width, height }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

export function resolveTargetSize(
  trimmedWidth: number,
  trimmedHeight: number,
  requestedWidth?: number,
  requestedHeight?: number,
): Size {
  const aspect = trimmedWidth / trimmedHeight

  if (requestedWidth && requestedHeight) {
    const fitByWidth = requestedWidth / trimmedWidth
    const fitByHeight = requestedHeight / trimmedHeight
    const scale = Math.min(fitByWidth, fitByHeight)
    return {
      width: roundPx(trimmedWidth * scale),
      height: roundPx(trimmedHeight * scale),
    }
  }

  if (requestedWidth) {
    return {
      width: roundPx(requestedWidth),
      height: roundPx(requestedWidth / aspect),
    }
  }

  if (requestedHeight) {
    return {
      width: roundPx(requestedHeight * aspect),
      height: roundPx(requestedHeight),
    }
  }

  return {
    width: roundPx(trimmedWidth),
    height: roundPx(trimmedHeight),
  }
}

export function expandCopies(
  artworks: ArtworkInput[],
  options: PackOptions,
): ExpandedCopy[] {
  const gutter = options.gutter
  const copies: ExpandedCopy[] = []

  for (const art of artworks) {
    const drawWidth = roundPx(art.targetWidth)
    const drawHeight = roundPx(art.targetHeight)
    const packWidth = roundPx(drawWidth + gutter)
    const packHeight = roundPx(drawHeight + gutter)

    for (let i = 0; i < art.quantity; i += 1) {
      copies.push({
        uid: `${art.id}__${i + 1}`,
        artworkId: art.id,
        drawWidth,
        drawHeight,
        packWidth,
        packHeight,
        allowRotate: art.allowRotate ?? true,
        trimBox: art.trimBox,
        sourceWidth: art.sourceWidth,
        sourceHeight: art.sourceHeight,
        meta: art.meta,
      })
    }
  }

  copies.sort((a, b) => {
    const areaDelta = b.packWidth * b.packHeight - a.packWidth * a.packHeight
    if (areaDelta !== 0) return areaDelta
    const longA = Math.max(a.packWidth, a.packHeight)
    const longB = Math.max(b.packWidth, b.packHeight)
    if (longB !== longA) return longB - longA
    const shortA = Math.min(a.packWidth, a.packHeight)
    const shortB = Math.min(b.packWidth, b.packHeight)
    if (shortB !== shortA) return shortB - shortA
    return a.uid.localeCompare(b.uid)
  })

  return copies
}

type ScoredPlacement = {
  x: number
  y: number
  width: number
  height: number
  rotated: boolean
  scoreShortSide: number
  scoreLongSide: number
}

class MaxRectsBin {
  readonly width: number
  readonly height: number
  readonly freeRects: Rect[]
  readonly usedRects: Rect[]

  constructor(width: number, height: number, originX = 0, originY = 0) {
    this.width = width
    this.height = height
    this.freeRects = [{ x: originX, y: originY, width, height }]
    this.usedRects = []
  }

  public findPosition(
    width: number,
    height: number,
    allowRotate: boolean,
  ): ScoredPlacement | null {
    let best: ScoredPlacement | null = null

    for (const free of this.freeRects) {
      if (width <= free.width && height <= free.height) {
        const leftoverHoriz = free.width - width
        const leftoverVert = free.height - height
        const shortSide = Math.min(leftoverHoriz, leftoverVert)
        const longSide = Math.max(leftoverHoriz, leftoverVert)
        const candidate: ScoredPlacement = {
          x: free.x,
          y: free.y,
          width,
          height,
          rotated: false,
          scoreShortSide: shortSide,
          scoreLongSide: longSide,
        }
        if (this.isBetter(candidate, best)) best = candidate
      }

      if (allowRotate && height <= free.width && width <= free.height) {
        const leftoverHoriz = free.width - height
        const leftoverVert = free.height - width
        const shortSide = Math.min(leftoverHoriz, leftoverVert)
        const longSide = Math.max(leftoverHoriz, leftoverVert)
        const candidate: ScoredPlacement = {
          x: free.x,
          y: free.y,
          width: height,
          height: width,
          rotated: true,
          scoreShortSide: shortSide,
          scoreLongSide: longSide,
        }
        if (this.isBetter(candidate, best)) best = candidate
      }
    }

    return best
  }

  public place(node: Rect): void {
    const nextFree: Rect[] = []

    for (const free of this.freeRects) {
      if (!rectsIntersect(free, node)) {
        nextFree.push(free)
        continue
      }
      if (node.x > free.x) {
        nextFree.push({ x: free.x, y: free.y, width: node.x - free.x, height: free.height })
      }
      if (node.x + node.width < free.x + free.width) {
        nextFree.push({
          x: node.x + node.width,
          y: free.y,
          width: free.x + free.width - (node.x + node.width),
          height: free.height,
        })
      }
      if (node.y > free.y) {
        nextFree.push({ x: free.x, y: free.y, width: free.width, height: node.y - free.y })
      }
      if (node.y + node.height < free.y + free.height) {
        nextFree.push({
          x: free.x,
          y: node.y + node.height,
          width: free.width,
          height: free.y + free.height - (node.y + node.height),
        })
      }
    }

    this.freeRects.length = 0
    this.freeRects.push(...this.pruneFreeRects(nextFree))
    this.usedRects.push(node)
  }

  private isBetter(candidate: ScoredPlacement, current: ScoredPlacement | null): boolean {
    if (!current) return true
    if (candidate.scoreShortSide !== current.scoreShortSide) {
      return candidate.scoreShortSide < current.scoreShortSide
    }
    if (candidate.scoreLongSide !== current.scoreLongSide) {
      return candidate.scoreLongSide < current.scoreLongSide
    }
    if (candidate.y !== current.y) return candidate.y < current.y
    return candidate.x < current.x
  }

  private pruneFreeRects(rects: Rect[]): Rect[] {
    const valid = rects.filter((r) => r.width > 0 && r.height > 0)
    const pruned: Rect[] = []
    for (let i = 0; i < valid.length; i += 1) {
      let contained = false
      for (let j = 0; j < valid.length; j += 1) {
        if (i === j) continue
        if (isContainedIn(valid[i], valid[j])) {
          contained = true
          break
        }
      }
      if (!contained) pruned.push(valid[i])
    }
    return pruned
  }
}

function createBin(options: PackOptions): MaxRectsBin {
  const edgePadding = options.edgePadding ?? 0
  const innerWidth = options.sheetWidth - edgePadding * 2
  const innerHeight = options.maxSheetHeight - edgePadding * 2
  if (innerWidth <= 0 || innerHeight <= 0) {
    throw new Error('Sheet size is smaller than edge padding.')
  }
  return new MaxRectsBin(innerWidth, innerHeight, edgePadding, edgePadding)
}

function canEverFit(copy: ExpandedCopy, options: PackOptions): boolean {
  const edgePadding = options.edgePadding ?? 0
  const usableWidth = options.sheetWidth - edgePadding * 2
  const usableHeight = options.maxSheetHeight - edgePadding * 2
  const allowRotate = (options.allowGlobalRotate ?? true) && copy.allowRotate
  const normalFit = copy.packWidth <= usableWidth && copy.packHeight <= usableHeight
  const rotatedFit = allowRotate && copy.packHeight <= usableWidth && copy.packWidth <= usableHeight
  return normalFit || rotatedFit
}

export function packGangSheets(
  artworks: ArtworkInput[],
  options: PackOptions,
): PackedSheet[] {
  const copies = expandCopies(artworks, options)
  const sheets: Array<{ bin: MaxRectsBin; placements: Placement[] }> = []

  for (const copy of copies) {
    if (!canEverFit(copy, options)) {
      throw new Error(
        `Artwork ${copy.artworkId} cannot fit on the sheet with current size, gutter, and edge padding.`,
      )
    }

    const allowRotate = (options.allowGlobalRotate ?? true) && copy.allowRotate
    let bestSheetIndex = -1
    let bestPlacement: ScoredPlacement | null = null

    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
      const candidate = sheets[sheetIndex].bin.findPosition(
        copy.packWidth,
        copy.packHeight,
        allowRotate,
      )
      if (!candidate) continue
      if (
        !bestPlacement ||
        candidate.scoreShortSide < bestPlacement.scoreShortSide ||
        (candidate.scoreShortSide === bestPlacement.scoreShortSide &&
          candidate.scoreLongSide < bestPlacement.scoreLongSide) ||
        (candidate.scoreShortSide === bestPlacement.scoreShortSide &&
          candidate.scoreLongSide === bestPlacement.scoreLongSide &&
          sheetIndex < bestSheetIndex)
      ) {
        bestSheetIndex = sheetIndex
        bestPlacement = candidate
      }
    }

    if (bestSheetIndex === -1 || !bestPlacement) {
      sheets.push({ bin: createBin(options), placements: [] })
      bestSheetIndex = sheets.length - 1
      bestPlacement = sheets[bestSheetIndex].bin.findPosition(
        copy.packWidth,
        copy.packHeight,
        allowRotate,
      )
      if (!bestPlacement) {
        throw new Error(`Artwork ${copy.artworkId} could not be placed on a fresh sheet.`)
      }
    }

    sheets[bestSheetIndex].bin.place({
      x: bestPlacement.x,
      y: bestPlacement.y,
      width: bestPlacement.width,
      height: bestPlacement.height,
    })

    sheets[bestSheetIndex].placements.push({
      ...copy,
      sheetIndex: bestSheetIndex,
      x: roundPx(bestPlacement.x),
      y: roundPx(bestPlacement.y),
      width: roundPx(bestPlacement.width),
      height: roundPx(bestPlacement.height),
      rotated: bestPlacement.rotated,
    })
  }

  return sheets.map((sheet, index) => {
    const edgePadding = options.edgePadding ?? 0
    const usedBottom = sheet.placements.reduce((max, p) => {
      return Math.max(max, p.y + p.height)
    }, edgePadding)
    return {
      index,
      width: options.sheetWidth,
      height: options.maxSheetHeight,
      usedHeight: Math.min(options.maxSheetHeight, Math.ceil(usedBottom + edgePadding)),
      placements: sheet.placements,
    }
  })
}

export function drawPlacementToCanvas(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  placement: Placement,
  gutter: number,
): void {
  const offset = gutter / 2
  const drawX = placement.x + offset
  const drawY = placement.y + offset

  if (!placement.rotated) {
    ctx.drawImage(
      image,
      placement.trimBox.x,
      placement.trimBox.y,
      placement.trimBox.width,
      placement.trimBox.height,
      drawX,
      drawY,
      placement.drawWidth,
      placement.drawHeight,
    )
    return
  }

  ctx.save()
  ctx.translate(drawX + placement.drawHeight / 2, drawY + placement.drawWidth / 2)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(
    image,
    placement.trimBox.x,
    placement.trimBox.y,
    placement.trimBox.width,
    placement.trimBox.height,
    -placement.drawWidth / 2,
    -placement.drawHeight / 2,
    placement.drawWidth,
    placement.drawHeight,
  )
  ctx.restore()
}
