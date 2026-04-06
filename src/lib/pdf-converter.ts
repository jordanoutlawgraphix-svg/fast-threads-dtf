// ============================================
// PDF to Image Converter
// ============================================
// Converts the first page of a PDF to a PNG image
// using pdf.js (pdfjs-dist). Runs client-side so
// staff can drop in PDFs and they auto-convert.
//
// DUAL-RENDER TECHNIQUE for background removal:
// Renders the PDF twice — once normally, once on
// a magenta background. Pixels that change between
// renders are background (no artwork). Pixels that
// stay white are actual white artwork content.
// This preserves white in designs while removing
// the PDF page background.
//
// PDFs contain vector artwork that can be rendered
// at ANY size without quality loss.

/**
 * Check if a file is a PDF
 */
export function isPDF(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  )
}

/**
 * Load pdfjs-dist with the correct worker CDN.
 */
async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'
  return pdfjsLib
}

// Magenta background color used for dual-render detection
const BG_R = 255
const BG_G = 0
const BG_B = 255

/**
 * Dual-render background removal.
 *
 * Compares two renders of the same PDF page:
 *   render1 = normal render (white page bg by default)
 *   render2 = rendered on bright magenta background
 *
 * Logic per pixel:
 *   If render1 is white/near-white AND render2 is magenta/near-magenta
 *     -> this pixel has NO artwork, it's page background -> transparent
 *   Otherwise
 *     -> keep the render1 pixel as-is (it's real artwork)
 */
function removeBackgroundDualRender(
  ctx1: CanvasRenderingContext2D,
  ctx2: CanvasRenderingContext2D,
  width: number,
  height: number,
  threshold: number = 20
) {
  const data1 = ctx1.getImageData(0, 0, width, height)
  const data2 = ctx2.getImageData(0, 0, width, height)
  const px1 = data1.data
  const px2 = data2.data

  for (let i = 0; i < px1.length; i += 4) {
    // Check if render2 pixel is close to our magenta background
    const dr = Math.abs(px2[i] - BG_R)
    const dg = Math.abs(px2[i + 1] - BG_G)
    const db = Math.abs(px2[i + 2] - BG_B)
    const isBg = dr < threshold && dg < threshold && db < threshold

    if (isBg) {
      // No artwork here — make transparent in render1
      px1[i + 3] = 0
    }
    // Otherwise keep render1 pixel unchanged (real artwork)
  }
  ctx1.putImageData(data1, 0, 0)
}

/**
 * Helper: render a PDF page onto a canvas, optionally
 * filling a background color first.
 */
async function renderPageToCanvas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  scale: number,
  bgColor?: string
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')

  if (bgColor) {
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  await page.render({ canvasContext: ctx, viewport }).promise
  return { canvas, ctx }
}

/**
 * Convert the first page of a PDF to a transparent PNG.
 * Renders at 300 DPI equivalent for preview and sizing.
 * Uses dual-render technique to preserve white artwork.
 */
export async function convertPDFToImage(
  pdfFile: File
): Promise<File> {
  const pdfjsLib = await loadPdfJs()
  const arrayBuffer = await pdfFile.arrayBuffer()

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  })

  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)

  // Render at 300 DPI (PDF points are 72 per inch)
  const scale = 300 / 72

  // Render 1: normal (white page background from PDF.js)
  const { canvas: c1, ctx: ctx1 } = await renderPageToCanvas(page, scale)
  // Render 2: magenta background to detect empty areas
  const { ctx: ctx2 } = await renderPageToCanvas(page, scale, `rgb(${BG_R},${BG_G},${BG_B})`)

  // Compare renders to remove only true background
  removeBackgroundDualRender(ctx1, ctx2, c1.width, c1.height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    c1.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Failed to convert PDF to PNG')),
      'image/png', 1.0
    )
  })

  page.cleanup()
  pdf.destroy()

  const baseName = pdfFile.name.replace(/\.pdf$/i, '')
  return new File([blob], `${baseName}.png`, { type: 'image/png' })
}

/**
 * Re-render a PDF at exact target dimensions at 300 DPI.
 * Vector data means perfect quality at any size.
 * Uses dual-render technique to preserve white artwork.
 */
export async function renderPDFAtSize(
  pdfFile: File,
  targetWidthInches: number,
  targetHeightInches: number,
  dpi: number = 300
): Promise<File> {
  const pdfjsLib = await loadPdfJs()
  const arrayBuffer = await pdfFile.arrayBuffer()

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  })

  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)

  // Get the page's native size in points (72 points = 1 inch)
  const defaultViewport = page.getViewport({ scale: 1 })
  const pageWidthPts = defaultViewport.width

  // Calculate target pixel dimensions
  const targetWidthPx = Math.round(targetWidthInches * dpi)
  const targetHeightPx = Math.round(targetHeightInches * dpi)

  // Scale to fill target width
  const scale = targetWidthPx / pageWidthPts
  const viewport = page.getViewport({ scale })

  // Helper to create a canvas at exact target size and render
  const renderAtTarget = async (bgColor?: string) => {
    const canvas = document.createElement('canvas')
    canvas.width = targetWidthPx
    canvas.height = targetHeightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')

    if (bgColor) {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    // Center the rendered PDF if aspect ratios differ
    const offsetX = (targetWidthPx - viewport.width) / 2
    const offsetY = (targetHeightPx - viewport.height) / 2
    ctx.translate(offsetX, offsetY)

    await page.render({ canvasContext: ctx, viewport }).promise

    // Reset transform before pixel processing
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    return { canvas, ctx }
  }

  // Render 1: normal (white page background)
  const { canvas: c1, ctx: ctx1 } = await renderAtTarget()
  // Render 2: magenta background to detect empty areas
  const { ctx: ctx2 } = await renderAtTarget(`rgb(${BG_R},${BG_G},${BG_B})`)

  // Compare renders to remove only true background
  removeBackgroundDualRender(ctx1, ctx2, targetWidthPx, targetHeightPx)

  const blob = await new Promise<Blob>((resolve, reject) => {
    c1.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Failed to render PDF at target size')),
      'image/png', 1.0
    )
  })

  page.cleanup()
  pdf.destroy()

  const baseName = pdfFile.name.replace(/\.pdf$/i, '')
  return new File(
    [blob],
    `${baseName}_${targetWidthInches}x${targetHeightInches}_${dpi}dpi.png`,
    { type: 'image/png' }
  )
}
