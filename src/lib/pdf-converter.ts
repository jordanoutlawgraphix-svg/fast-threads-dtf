// ============================================
// PDF to Image Converter
// ============================================
// Converts the first page of a PDF to a PNG image
// using pdf.js (pdfjs-dist). This runs client-side
// so staff can drop in PDFs and they auto-convert
// before being sent to the gang sheet.

import * as pdfjsLib from 'pdfjs-dist'

// Set worker source to CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs'

/**
 * Check if a file is a PDF
 */
export function isPDF(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

/**
 * Convert the first page of a PDF to a PNG File object.
 * Renders at 300 DPI equivalent for print quality.
 */
export async function convertPDFToImage(pdfFile: File): Promise<File> {
  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1)

  // Render at 300 DPI equivalent
  // PDF pages are measured in points (72 per inch)
  // Scale factor of ~4.17 gives us roughly 300 DPI output
  const scale = 300 / 72
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context for PDF rendering')

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

  // Create a File object from the blob, preserving the original name
  const baseName = pdfFile.name.replace(/\.pdf$/i, '')
  return new File([blob], `${baseName}.png`, { type: 'image/png' })
}
