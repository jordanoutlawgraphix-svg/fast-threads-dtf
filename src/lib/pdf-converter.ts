// ============================================
// PDF to Image Converter
// ============================================
// Converts the first page of a PDF to a PNG image
// using pdf.js (pdfjs-dist). Runs client-side so
// staff can drop in PDFs and they auto-convert.
//
// KEY: White background is removed after rendering
// so DTF gang sheets have transparent backgrounds.
// The RIP software (CADlink) handles white ink.
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

/**
 * Remove white/near-white background from a canvas by
 * converting those pixels to transparent.
 *
 * Threshold: pixels with R,G,B all above 240 are treated
 * as background and made fully transparent. This preserves
 * light-colored artwork while removing the PDF white page.
 */
function removeWhiteBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  threshold: number = 240
) {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (r >= threshold && g >= threshold && b >= threshold) {
      // White or near-white pixel -> make transparent
      data[i + 3] = 0
    }
  }
  ctx.putImageData(imageData, 0, 0)
}

/**
 * Convert the first page of a PDF to a transparent PNG.
 * Renders at 300 DPI equivalent for preview and sizing.
 * White background is automatically removed.
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
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')

  // Render PDF page (pdf.js draws white background by default)
  await page.render({ canvasContext: ctx, viewport }).promise

  // Remove the white background so DTF output is transparent
  removeWhiteBackground(ctx, canvas.width, canvas.height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
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
 * White background is automatically removed.
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

  // Scale to fill target width (preserves aspect ratio)
  const scale = targetWidthPx / pageWidthPts

  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = targetWidthPx
  canvas.height = targetHeightPx

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')

  // DO NOT fill with white - keep canvas transparent
  // Center the rendered PDF if aspect ratios differ
  const offsetX = (targetWidthPx - viewport.width) / 2
  const offsetY = (targetHeightPx - viewport.height) / 2
  ctx.translate(offsetX, offsetY)

  await page.render({ canvasContext: ctx, viewport }).promise

  // Reset transform before pixel processing
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  // Remove white background for transparent DTF output
  removeWhiteBackground(ctx, canvas.width, canvas.height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
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
