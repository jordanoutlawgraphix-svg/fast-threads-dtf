// ============================================
// PDF to Image Converter
// ============================================
// Converts the first page of a PDF to a PNG image
// using pdf.js (pdfjs-dist). This runs client-side
// so staff can drop in PDFs and they auto-convert
// before being sent to the gang sheet.

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
 * Convert the first page of a PDF to a PNG File object.
 * Renders at 300 DPI for print quality.
 *
 * Uses dynamic import to avoid SSR issues with
 * Next.js and sets up the worker via CDN.
 */
export async function convertPDFToImage(
  pdfFile: File
): Promise<File> {
  // Dynamic import avoids SSR/build-time crashes
  const pdfjsLib = await import('pdfjs-dist')

  // Use the legacy build worker (.js not .mjs)
  // to avoid ES module loading issues in browsers
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'

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
    throw new Error(
      'Failed to get canvas context for PDF rendering'
    )
  }

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise
  // Convert canvas to PNG blob
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

  // Clean up
  page.cleanup()
  pdf.destroy()

  // Create a File object, preserving original name
  const baseName = pdfFile.name.replace(/\.pdf$/i, '')
  return new File([blob], `${baseName}.png`, {
    type: 'image/png',
  })
}