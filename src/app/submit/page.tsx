'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  PlacementType,
  GarmentAge,
  PLACEMENT_LABELS,
  LOCATIONS,
  SubmissionItemData,
  DEFAULT_SIZE_PROFILES,
} from '@/types'
import {
  calculateTargetSize,
  detectImageDimensions,
  validateItemSizing,
} from '@/lib/sizing-engine'
import * as store from '@/lib/store'
import { isPDF, convertPDFToImage, renderPDFAtSize } from '@/lib/pdf-converter'

// Placement codes for auto-naming items
const PLACEMENT_CODES: Record<PlacementType, string> = {
  left_chest: 'LC',
  full_front: 'FF',
  full_back: 'FB',
  sleeve_left: 'SL',
  sleeve_right: 'SR',
  numbers: 'NUM',
  names: 'NAM',
  custom: 'CST',
}

/** Generate a dynamic item label like "38192-FF 11x5 4QTY" */
function getItemLabel(invoiceNumber: string, item: SubmissionItemData): string {
  const inv = invoiceNumber.trim() || '???'
  const code = PLACEMENT_CODES[item.placement] || item.placement
  const age = item.garment_age === 'youth' ? ' YTH' : ''
  const w = item.confirmed_width_inches || 0
  const h = item.confirmed_height_inches || 0
  const size = w > 0 && h > 0 ? ` ${w}x${h}` : ''
  const qty = item.quantity > 0 ? ` ${item.quantity}QTY` : ''
  return `${inv}-${code}${age}${size}${qty}`
}

const EMPTY_ITEM: SubmissionItemData = {
  file: null,
  originalPdfFile: null,
  placement: 'left_chest',
  garment_age: 'adult',
  quantity: 1,
  custom_placement_name: '',
  detected_width_px: 0,
  detected_height_px: 0,
  suggested_width_inches: 0,
  suggested_height_inches: 0,
  confirmed_width_inches: 0,
  confirmed_height_inches: 0,
  size_confirmed: false,
}

export default function SubmitJobPage() {
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [locationId, setLocationId] = useState(LOCATIONS[0].id)
  const [submitterName, setSubmitterName] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<SubmissionItemData[]>([{ ...EMPTY_ITEM }])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasYouthGarments, setHasYouthGarments] = useState<boolean | null>(null)
  const [youthConfirmed, setYouthConfirmed] = useState(false)

  const updateItem = useCallback((index: number, updates: Partial<SubmissionItemData>) => {
    setItems(prev => {
      const newItems = [...prev]
      newItems[index] = { ...newItems[index], ...updates }
      return newItems
    })
  }, [])

  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }])

  const removeItem = (index: number) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const duplicateItem = (index: number, asYouth: boolean) => {
    const source = items[index]
    const newItem: SubmissionItemData = {
      ...source,
      garment_age: asYouth ? 'youth' : source.garment_age,
      size_confirmed: false,
    }
    setItems(prev => {
      const updated = [...prev]
      updated.splice(index + 1, 0, newItem)
      return updated
    })
  }

  const handleFileChange = async (index: number, file: File | null) => {
    if (!file) {
      updateItem(index, { file: null, originalPdfFile: null, detected_width_px: 0, detected_height_px: 0 })
      return
    }

    let originalPdf: File | null = null
    let processedFile = file

    if (isPDF(file)) {
      originalPdf = file
      try {
        processedFile = await convertPDFToImage(file)
      } catch (err) {
        console.error('PDF conversion error:', err)
        setError('Failed to convert PDF. Make sure it contains at least one page.')
        return
      }
    }

    const validTypes = ['image/png', 'image/jpeg', 'image/tiff', 'image/webp']
    if (!validTypes.includes(processedFile.type)) {
      setError(`Invalid file type: ${file.type}. Please use PNG, JPG, TIFF, WebP, or PDF.`)
      return
    }
    try {
      file = processedFile
      const dims = await detectImageDimensions(file)
      const item = items[index]
      const sizing = calculateTargetSize(dims.width, dims.height, 300, item.placement, item.garment_age)
      updateItem(index, {
        file,
        originalPdfFile: originalPdf,
        detected_width_px: dims.width,
        detected_height_px: dims.height,
        suggested_width_inches: sizing.target_width_inches,
        suggested_height_inches: sizing.target_height_inches,
        confirmed_width_inches: sizing.target_width_inches,
        confirmed_height_inches: sizing.target_height_inches,
        size_confirmed: false,
      })
      setError(null)
    } catch {
      setError('Failed to read image dimensions. Please try a different file.')
    }
  }

  const handlePlacementChange = (index: number, placement: PlacementType) => {
    updateItem(index, { placement, size_confirmed: false })
  }

  const handleAgeChange = (index: number, garmentAge: GarmentAge) => {
    updateItem(index, { garment_age: garmentAge, size_confirmed: false })
  }

  const handleSubmit = async () => {
    if (!invoiceNumber.trim()) { setError('Invoice number is required.'); return }
    if (!submitterName.trim()) { setError('Your name is required.'); return }
    if (hasYouthGarments === null) { setError('Please answer: Are there youth garments in this order?'); return }
    if (hasYouthGarments && !youthConfirmed) { setError('Please confirm that you have added separate items for youth sizes.'); return }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.file) { setError(`Item ${i + 1}: Please upload a file.`); return }
      if (item.quantity < 1) { setError(`Item ${i + 1}: Quantity must be at least 1.`); return }
      if (!item.size_confirmed) { setError(`Item ${i + 1}: Please confirm the print size.`); return }
      if (item.placement === 'custom' && !item.custom_placement_name.trim()) { setError(`Item ${i + 1}: Please specify the custom placement name.`); return }
      if (!item.originalPdfFile) {
        const validation = validateItemSizing(item.detected_width_px, item.detected_height_px, item.confirmed_width_inches, item.confirmed_height_inches, item.placement, item.garment_age)
        if (!validation.valid) { setError(`Item ${i + 1}: ${validation.errors.join(' ')}`); return }
      }
    }

    setSubmitting(true)
    setError(null)

    try {
      const location = LOCATIONS.find(l => l.id === locationId)!
      const jobId = uuidv4()

      const job = await store.createJob({
        id: jobId,
        invoice_number: invoiceNumber.trim(),
        location_id: locationId,
        location_code: location.code,
        submitter_name: submitterName.trim(),
        status: 'submitted',
        notes: notes.trim() || null,
      })

      if (!job) throw new Error('Failed to create job')

      for (const item of items) {
        const itemId = uuidv4()

        let uploadFile = item.file!
        if (item.originalPdfFile) {
          try {
            uploadFile = await renderPDFAtSize(
              item.originalPdfFile,
              item.confirmed_width_inches,
              item.confirmed_height_inches,
              300
            )
          } catch (err) {
            console.error('PDF re-render error:', err)
          }
        }

        const ext = uploadFile.name.split('.').pop() || 'png'
        const filePath = `jobs/${jobId}/${itemId}.${ext}`

        const fileUrl = await store.uploadFile(uploadFile, filePath)

        const finalWidthPx = item.originalPdfFile
          ? Math.round(item.confirmed_width_inches * 300)
          : item.detected_width_px
        const finalHeightPx = item.originalPdfFile
          ? Math.round(item.confirmed_height_inches * 300)
          : item.detected_height_px

        await store.createJobItem({
          id: itemId,
          job_id: jobId,
          placement: item.placement,
          garment_age: item.garment_age,
          quantity: item.quantity,
          original_filename: item.originalPdfFile ? item.originalPdfFile.name : item.file!.name,
          file_path: filePath,
          thumbnail_path: filePath,
          source_width_px: finalWidthPx,
          source_height_px: finalHeightPx,
          source_dpi: 300,
          target_width_inches: item.confirmed_width_inches,
          target_height_inches: item.confirmed_height_inches,
          size_auto: true,
          size_confirmed: item.size_confirmed,
          custom_placement_name: item.placement === 'custom' ? item.custom_placement_name : null,
          notes: null,
        })
      }

      setSubmitted(true)
    } catch (err) {
      console.error(err)
      setError('Failed to submit job. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-2">Job Submitted Successfully!</h2>
        <p className="text-gray-400 mb-6">Invoice #{invoiceNumber} has been added to the print queue.</p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={() => { setSubmitted(false); setInvoiceNumber(''); setNotes(''); setItems([{ ...EMPTY_ITEM }]); setHasYouthGarments(null); setYouthConfirmed(false) }}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            Submit Another Job
          </button>
          <a href="/queue" className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors">View Queue</a>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Submit DTF Job</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-800/50 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 className="font-semibold mb-4">Job Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Invoice Number *</label>
            <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g., INV-2024-001"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Location *</label>
            <select value={locationId} onChange={e => setLocationId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500">
              {LOCATIONS.map(loc => (<option key={loc.id} value={loc.id}>{loc.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Your Name *</label>
            <input type="text" value={submitterName} onChange={e => setSubmitterName(e.target.value)} placeholder="Who is submitting this?"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-sm text-gray-400 mb-1">Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions..." rows={2}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
        </div>
      </div>

      <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-6 mb-6">
        <h2 className="font-semibold mb-3 text-yellow-300">Youth Garment Check</h2>
        <p className="text-sm text-gray-300 mb-4">
          Does this order include any youth/kids garments? If yes, you MUST submit separate items with
          youth sizing — adult prints do not automatically fit youth garments correctly.
        </p>
        <div className="flex gap-4">
          <button onClick={() => { setHasYouthGarments(true); setYouthConfirmed(false) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${hasYouthGarments === true ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
            Yes, there are youth garments
          </button>
          <button onClick={() => { setHasYouthGarments(false); setYouthConfirmed(false) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${hasYouthGarments === false ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
            No, adults only
          </button>
        </div>
        {hasYouthGarments && (
          <div className="mt-4 p-3 bg-yellow-900/30 rounded-lg">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={youthConfirmed} onChange={e => setYouthConfirmed(e.target.checked)} className="mt-1 w-4 h-4 accent-orange-500" />
              <span className="text-sm text-yellow-200">
                I confirm that I have (or will) add separate line items for youth sizes below,
                with the garment type set to &ldquo;Youth.&rdquo; I understand that adult sizes will NOT be
                automatically used for youth garments.
              </span>
            </label>
          </div>
        )}
      </div>

      <div className="space-y-6 mb-6">
        {items.map((item, index) => (
          <ItemForm key={index} index={index} item={item} invoiceNumber={invoiceNumber} onUpdate={updateItem} onFileChange={handleFileChange}
            onPlacementChange={handlePlacementChange} onAgeChange={handleAgeChange} onRemove={removeItem} onDuplicate={duplicateItem} canRemove={items.length > 1} />
        ))}
      </div>

      <div className="flex gap-4 mb-8">
        <button onClick={addItem} className="px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm">
          + Add Another Print
        </button>
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => { setInvoiceNumber(''); setSubmitterName(''); setNotes(''); setItems([{ ...EMPTY_ITEM }]); setHasYouthGarments(null); setYouthConfirmed(false); setError(null) }}
          className="px-6 py-3 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors font-medium"
        >
          Clear / Start Over
        </button>
        <button onClick={handleSubmit} disabled={submitting}
          className="px-8 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
          {submitting ? 'Submitting...' : 'Submit Job'}
        </button>
      </div>
    </div>
  )
}

function ItemForm({ index, item, invoiceNumber, onUpdate, onFileChange, onPlacementChange, onAgeChange, onRemove, onDuplicate, canRemove }: {
  index: number; item: SubmissionItemData; invoiceNumber: string; onUpdate: (i: number, u: Partial<SubmissionItemData>) => void
  onFileChange: (i: number, f: File | null) => void; onPlacementChange: (i: number, p: PlacementType) => void
  onAgeChange: (i: number, a: GarmentAge) => void; onRemove: (i: number) => void; onDuplicate: (i: number, asYouth: boolean) => void; canRemove: boolean
}) {
  const isVector = !!item.originalPdfFile
  const validation = item.detected_width_px > 0 && !isVector
    ? validateItemSizing(item.detected_width_px, item.detected_height_px, item.confirmed_width_inches, item.confirmed_height_inches, item.placement, item.garment_age)
    : null
  const placementValidation = item.detected_width_px > 0 && isVector
    ? (() => {
        const profile = DEFAULT_SIZE_PROFILES.find(sp => sp.placement === item.placement && sp.garment_age === item.garment_age)
        const warnings: string[] = []
        if (profile) {
          if (item.confirmed_width_inches > profile.width_inches * 1.1) {
            warnings.push(`Width (${item.confirmed_width_inches}") exceeds recommended max for ${profile.label} (${profile.width_inches}").`)
          }
          if (item.confirmed_height_inches > profile.height_inches * 1.1) {
            warnings.push(`Height (${item.confirmed_height_inches}") exceeds recommended max for ${profile.label} (${profile.height_inches}").`)
          }
        }
        return warnings.length > 0 ? { warnings } : null
      })()
    : null

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // Aspect ratio from source file — used to lock proportions
  const aspectRatio = item.detected_width_px > 0 && item.detected_height_px > 0
    ? item.detected_width_px / item.detected_height_px
    : 1

  /** Change width and auto-calculate height to maintain aspect ratio */
  const handleWidthChange = (newWidth: number) => {
    if (newWidth <= 0) {
      onUpdate(index, { confirmed_width_inches: newWidth, size_confirmed: false })
      return
    }
    const newHeight = Math.round((newWidth / aspectRatio) * 100) / 100
    onUpdate(index, {
      confirmed_width_inches: newWidth,
      confirmed_height_inches: newHeight,
      size_confirmed: false,
    })
  }

  /** Change height and auto-calculate width to maintain aspect ratio */
  const handleHeightChange = (newHeight: number) => {
    if (newHeight <= 0) {
      onUpdate(index, { confirmed_height_inches: newHeight, size_confirmed: false })
      return
    }
    const newWidth = Math.round((newHeight * aspectRatio) * 100) / 100
    onUpdate(index, {
      confirmed_width_inches: newWidth,
      confirmed_height_inches: newHeight,
      size_confirmed: false,
    })
  }

  const processFile = async (file: File | null) => {
    if (!file) { setPreviewUrl(null) }
    await onFileChange(index, file)
  }

  useEffect(() => {
    if (item.file) {
      const url = URL.createObjectURL(item.file)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setPreviewUrl(null)
    }
  }, [item.file])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await processFile(e.target.files?.[0] || null)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0] || null
    if (file) {
      const validTypes = ['image/png', 'image/jpeg', 'image/tiff', 'image/webp', 'application/pdf']
      if (validTypes.includes(file.type) || file.name.toLowerCase().endsWith('.pdf')) {
        await processFile(file)
      }
    }
  }

  const clearFile = () => {
    setPreviewUrl(null)
    onFileChange(index, null)
    onUpdate(index, { size_confirmed: false })
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Print Item #{index + 1}</h3>
            {isVector && (
              <span className="text-[10px] px-1.5 py-0.5 bg-green-900/40 border border-green-700/50 text-green-300 rounded font-medium">
                VECTOR PDF — scales to any size at 300 DPI
              </span>
            )}
          </div>
          {item.file && item.confirmed_width_inches > 0 && (
            <p className="text-xs text-orange-400 font-mono mt-1">{getItemLabel(invoiceNumber, item)}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {item.file && (
            <button onClick={() => onDuplicate(index, item.garment_age === 'adult')}
              className="text-xs px-2 py-1 bg-blue-900/40 border border-blue-700/50 text-blue-300 rounded hover:bg-blue-800/40 transition-colors">
              {item.garment_age === 'adult' ? '+ Duplicate as Youth' : '+ Duplicate as Adult'}
            </button>
          )}
          {canRemove && <button onClick={() => onRemove(index)} className="text-sm text-red-400 hover:text-red-300">Remove</button>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm text-gray-400 mb-1">File *</label>
          {!previewUrl ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                dragging
                  ? 'border-orange-500 bg-orange-900/20'
                  : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
              }`}
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/tiff,image/webp,application/pdf,.pdf"
                onChange={handleFile}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="pointer-events-none">
                <svg className="w-8 h-8 mx-auto text-gray-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-gray-400">Drag & drop file here</p>
                <p className="text-xs text-gray-600 mt-1">or click to browse — PNG, JPG, TIFF, WebP, PDF</p>
              </div>
            </div>
          ) : (
            <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-800 p-2 relative">
              <img src={previewUrl} alt="Preview" className="max-h-40 mx-auto object-contain" />
              <button
                onClick={clearFile}
                className="absolute top-1 right-1 w-6 h-6 bg-red-600 text-white rounded-full text-xs font-bold hover:bg-red-500 flex items-center justify-center"
                title="Remove file"
              >
                X
              </button>
            </div>
          )}
          {item.detected_width_px > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {isVector
                ? `Vector source — will render at 300 DPI at any size`
                : `Source: ${item.detected_width_px} x ${item.detected_height_px}px`
              }
            </p>
          )}
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Placement *</label>
              <select value={item.placement} onChange={e => onPlacementChange(index, e.target.value as PlacementType)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500">
                {Object.entries(PLACEMENT_LABELS).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Garment *</label>
              <select value={item.garment_age} onChange={e => onAgeChange(index, e.target.value as GarmentAge)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500">
                <option value="adult">Adult</option>
                <option value="youth">Youth</option>
              </select>
            </div>
          </div>
          {item.placement === 'custom' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Custom Placement Name *</label>
              <input type="text" value={item.custom_placement_name} onChange={e => onUpdate(index, { custom_placement_name: e.target.value })}
                placeholder="e.g., Right hip, Hat front..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500" />
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Quantity *</label>
            <input type="number" min={1} value={item.quantity} onChange={e => onUpdate(index, { quantity: parseInt(e.target.value) || 1 })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500" />
          </div>
          {item.detected_width_px > 0 && (
            <div className="p-3 bg-gray-800 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Print Size</p>
                <span className="text-[10px] text-gray-500">Aspect ratio locked</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Width (inches)</label>
                  <input type="number" step="0.25" min="0.5" value={item.confirmed_width_inches}
                    onChange={e => handleWidthChange(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Height (inches)</label>
                  <input type="number" step="0.25" min="0.5" value={item.confirmed_height_inches}
                    onChange={e => handleHeightChange(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-orange-500" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Placement max: {(() => {
                const p = DEFAULT_SIZE_PROFILES.find(sp => sp.placement === item.placement && sp.garment_age === item.garment_age)
                return p ? `${p.width_inches}" x ${p.height_inches}"` : 'N/A'
              })()}</p>
              {isVector && (
                <p className="text-xs text-green-400 mt-1">Vector source — 300 DPI guaranteed at any size</p>
              )}
              {validation && validation.warnings.length > 0 && (
                <div className="mt-2">{validation.warnings.map((w, i) => (<p key={i} className="text-xs text-yellow-400 mt-1">{w}</p>))}</div>
              )}
              {validation && validation.errors.length > 0 && (
                <div className="mt-2">{validation.errors.map((e, i) => (<p key={i} className="text-xs text-red-400 mt-1">{e}</p>))}</div>
              )}
              {placementValidation && placementValidation.warnings.length > 0 && (
                <div className="mt-2">{placementValidation.warnings.map((w, i) => (<p key={i} className="text-xs text-yellow-400 mt-1">{w}</p>))}</div>
              )}
              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input type="checkbox" checked={item.size_confirmed} onChange={e => onUpdate(index, { size_confirmed: e.target.checked })} className="w-4 h-4 accent-orange-500" />
                <span className="text-sm text-gray-300">I confirm this print size is correct</span>
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
