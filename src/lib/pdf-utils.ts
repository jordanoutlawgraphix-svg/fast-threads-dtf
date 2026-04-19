// ============================================
// PDF Utilities — PDF-Native, No Conversion
// ============================================
// CRITICAL: The original PDF is NEVER modified or rasterized for
// production output. Spot colors must be preserved end-to-end so
// NeoStampa can RIP against our custom screen-print ink library.
//
// This module only:
//   1. Reads page dimensions from a PDF (vector metadata, no rasterization)
//   2. Renders a PREVIEW thumbnail — strictly for on-screen display and
//      the printable batch summary sheet. Preview only. Never for print.

/**
 * Strict PDF type check. We accept PDFs and nothing else.
 */
export function isPDF(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  )
}

/**
 * Lazy-load pdfjs-dist with the worker CDN.
 */
async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'
  return pdfjsLib
}

export interface PdfDimensions {
  width_inches: number
  height_inches: number
  width_points: number
  height_points: number
  page_count: number
}

/**
 * Read the first page's dimensions in inches from a PDF.
 * No rasterization — just metadata. PDF user-space is 72 pts/inch.
 */
export async function getPdfDimensions(file: File): Promise<PdfDimensions> {
  const pdfjsLib = await loadPdfJs()
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
  })
  const pdf = await loadingTask.promise
  try {
    const page = await pdf.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    page.cleanup()
    return {
      width_inches: round2(vp.width / 72),
      height_inches: round2(vp.height / 72),
      width_points: vp.width,
      height_points: vp.height,
      page_count: pdf.numPages,
    }
  } finally {
    pdf.destroy()
  }
}

/**
 * Render a small preview thumbnail of a PDF (first page) as a data URL.
 * FOR DISPLAY ONLY. Never used for production print output.
 *
 * @param file  PDF file to render
 * @param maxPx Max pixel dimension (width or height) for the thumbnail
 */
export async function renderPdfThumbnail(
  file: File | Blob,
  maxPx: number = 400,
): Promise<string> {
  const pdfjsLib = await loadPdfJs()
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
  })
  const pdf = await loadingTask.promise
  try {
    const page = await pdf.getPage(1)
    const vp1 = page.getViewport({ scale: 1 })
    const scale = Math.min(maxPx / vp1.width, maxPx / vp1.height)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')
    // White background for the thumbnail so on-white art is still visible.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    page.cleanup()
    return canvas.toDataURL('image/png')
  } finally {
    pdf.destroy()
  }
}

/**
 * Fetch a stored PDF by URL and render a thumbnail from it.
 * Used on the batch summary page where files have already been uploaded.
 */
export async function renderPdfThumbnailFromUrl(
  url: string,
  maxPx: number = 400,
): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`)
  const blob = await res.blob()
  return renderPdfThumbnail(blob, maxPx)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
