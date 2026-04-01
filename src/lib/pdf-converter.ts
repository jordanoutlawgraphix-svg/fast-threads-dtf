// ============================================
// PDF to Image Converter
// ============================================
// Converts the first page of a PDF to a PNG image
// using pdf.js (pdfjs-dist). This runs client-side
// so staff can drop in PDFs and they auto-convert
// before being sent to the gang sheet.
//
// KEY FEATURE: PDFs contain vector artwork that can be
// rendered at ANY size without quality loss. We keep the
// original PDF and re-render at the final target dimensions
// to guarantee 300 DPI at any print size.

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
 * Shared by both convert functions.
 */
async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'
  return pdfjsLib
}

/**
 * Convert the first page of a PDF to a PNG File object.
 * Renders at the PDF's native size × 300/72 scale (≈300 DPI).
 * Used for the initial preview and default dimensions.
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

  // Render at 300 DPI equivalent
  // PDF pages are in points (72 per inch)
  // Scale of 300/72 ≈ 4.17 gives ~300 DPI output
  const scale = 300 / 72
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get canvas context for PDF rendering')
  }

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Failed to convert PDF page to PNG'))
      },
      'image/png',
      1.0
    )
  })

  page.cleanup()
  pdf.destroy()

  const baseName = pdfFile.name.replace(/\.pdf$/i, '')
  return new File([blob], `${baseName}.png`, {
    type: 'image/png',
  })
}

/**
 * Re-render a PDF at exact target dimensions in inches at 300 DPI.
 *
 * Because PDFs contain vector data, this produces a perfect 300 DPI
 * raster at ANY size — no quality loss from scaling up.
 *
 * @param pdfFile - The original PDF file
 * @param targetWidthInches - Desired print width in inches
 * @param targetHeightInches - Desired print height in inches
 * @param dpi - Target DPI (default 300)
 * @returns PNG File at exactly targetWidth×dpi by targetHeight×dpi pixels
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
  const pageHeightPts = defaultViewport.height

  // Calculate target pixel dimensions
  const targetWidthPx = Math.round(targetWidthInches * dpi)
  const targetHeightPx = Math.round(targetHeightInches * dpi)

  // Scale to fit the target dimensions while preserving aspect ratio
  // Use the larger scale factor to fill the target area, then we crop
  // Or use the dimension that the user set — scale based on width
  const scaleX = targetWidthPx / pageWidthPts
  const scaleY = targetHeightPx / pageHeightPts

  // Use uniform scale to preserve aspect ratio — pick the scale
  // that makes the PDF fill the target width (most common for prints)
  const scale = scaleX

  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  // Use exact target dimensions for the canvas
  canvas.width = targetWidthPx
  canvas.height = targetHeightPx

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get canvas context for PDF rendering')
  }

  // Fill with white background in case PDF has transparency
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Center the rendered PDF in the canvas if aspect ratios differ
  const renderedWidth = viewport.width
  const renderedHeight = viewport.height
  const offsetX = (targetWidthPx - renderedWidth) / 2
  const offsetY = (targetHeightPx - renderedHeight) / 2

  // Use a transform to offset the rendering
  ctx.translate(offsetX, offsetY)

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Failed to render PDF at target size'))
      },
      'image/png',
      1.0
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
