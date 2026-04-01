'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  PlacementType,
  GarmentAge,
  PLACEMENT_LABELS,
  LOCATIONS,
  SubmissionItemData,
} from '@/types'
import {
  calculateTargetSize,
  calculateYouthFromAdult,
  detectImageDimensions,
  validateItemSizing,
} from '@/lib/sizing-engine'
import * as store from '@/lib/store'
import { isPDF, convertPDFToImage } from '@/lib/pdf-converter'

const EMPTY_ITEM: SubmissionItemData = {
  file: null,
  placement: 'left_chest',
  garment_age: 'adult',
  quantity: 1,
  custom_placement_name: '',  detected_width_px: 0,
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
  const [validationToast, setValidationToast] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to error banner when a validation error is set
  useEffect(() => {
    if (error && errorRef.current) {      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [error])

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (validationToast) {
      const timer = setTimeout(() => setValidationToast(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [validationToast])

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
  const handleFileChange = async (index: number, file: File | null) => {
    if (!file) {
      updateItem(index, { file: null, detected_width_px: 0, detected_height_px: 0 })
      return
    }

    // Convert PDF to PNG automatically
    let processedFile = file
    if (isPDF(file)) {
      try {
        processedFile = await convertPDFToImage(file)
      } catch {
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
      const dims = await detectImageDimensions(file)      const item = items[index]
      const sizing = calculateTargetSize(dims.width, dims.height, 300, item.placement, item.garment_age)
      updateItem(index, {
        file,
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
    const item = items[index]
    if (item.detected_width_px > 0) {
      const sizing = calculateTargetSize(item.detected_width_px, item.detected_height_px, 300, placement, item.garment_age)
      updateItem(index, {
        placement,
        suggested_width_inches: sizing.target_width_inches,
        suggested_height_inches: sizing.target_height_inches,        confirmed_width_inches: sizing.target_width_inches,
        confirmed_height_inches: sizing.target_height_inches,
        size_confirmed: false,
      })
    } else {
      updateItem(index, { placement })
    }
  }

  const handleAgeChange = (index: number, garmentAge: GarmentAge) => {
    const item = items[index]
    if (item.detected_width_px > 0) {
      let sizing
      if (garmentAge === 'youth' && item.garment_age === 'adult' && item.confirmed_width_inches > 0) {
        const youthSize = calculateYouthFromAdult(item.confirmed_width_inches, item.confirmed_height_inches, item.placement)
        sizing = { target_width_inches: youthSize.width, target_height_inches: youthSize.height }
      } else {
        sizing = calculateTargetSize(item.detected_width_px, item.detected_height_px, 300, item.placement, garmentAge)
      }
      updateItem(index, {
        garment_age: garmentAge,
        suggested_width_inches: sizing.target_width_inches,
        suggested_height_inches: sizing.target_height_inches,
        confirmed_width_inches: sizing.target_width_inches,
        confirmed_height_inches: sizing.target_height_inches,        size_confirmed: false,
      })
    } else {
      updateItem(index, { garment_age: garmentAge })
    }
  }

  const handleSubmit = async () => {
    const showValidationError = (msg: string) => {
      setError(msg)
      setValidationToast(msg)
    }

    if (!invoiceNumber.trim()) { showValidationError('Invoice number is required.'); return }
    if (!submitterName.trim()) { showValidationError('Your name is required.'); return }
    if (hasYouthGarments === null) { showValidationError('Please answer: Are there youth garments in this order?'); return }
    if (hasYouthGarments && !youthConfirmed) { showValidationError('Please confirm that you have added separate items for youth sizes.'); return }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.file) { showValidationError(`Item ${i + 1}: Please upload a file.`); return }
      if (item.quantity < 1) { showValidationError(`Item ${i + 1}: Quantity must be at least 1.`); return }
      if (!item.size_confirmed) { showValidationError(`Item ${i + 1}: Please confirm the print size.`); return }
      if (item.placement === 'custom' && !item.custom_placement_name.trim()) { showValidationError(`Item ${i + 1}: Please specify the custom placement name.`); return }
      const validation = validateItemSizing(item.detected_width_px, item.detected_height_px, item.confirmed_width_inches, item.confirmed_height_inches, item.placement, item.garment_age)      if (!validation.valid) { showValidationError(`Item ${i + 1}: ${validation.errors.join(' ')}`); return }
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
        const ext = item.file!.name.split('.').pop() || 'png'        const filePath = `jobs/${jobId}/${itemId}.${ext}`

        // Upload file to Supabase Storage
        const fileUrl = await store.uploadFile(item.file!, filePath)

        await store.createJobItem({
          id: itemId,
          job_id: jobId,
          placement: item.placement,
          garment_age: item.garment_age,
          quantity: item.quantity,
          original_filename: item.file!.name,
          file_path: filePath,
          thumbnail_path: filePath,
          source_width_px: item.detected_width_px,
          source_height_px: item.detected_height_px,
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
            Submit Another Job          </button>
          <a href="/queue" className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors">View Queue</a>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Submit DTF Job</h1>

      {error && (
        <div ref={errorRef} className="mb-6 p-4 bg-red-900/30 border border-red-800/50 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      {/* Job Info */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 className="font-semibold mb-4">Job Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Invoice Number *</label>
            <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g., INV-2024-001"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
          </div>
          <div>            <label className="block text-sm text-gray-400 mb-1">Location *</label>
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

      {/* Youth Garment Check */}
      <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-6 mb-6">
        <h2 className="font-semibold mb-3 text-yellow-300">Youth Garment Check</h2>
        <p className="text-sm text-gray-300 mb-4">
          Does this order include any youth/kids garments? If yes, you MUST submit separate items with
          youth sizing — adult prints do not automatically fit youth garments correctly.        </p>
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

      {/* Print Items */}      <div className="space-y-6 mb-6">
        {items.map((item, index) => (
          <ItemForm key={index} index={index} item={item} onUpdate={updateItem} onFileChange={handleFileChange}
            onPlacementChange={handlePlacementChange} onAgeChange={handleAgeChange} onRemove={removeItem} canRemove={items.length > 1} />
        ))}
      </div>

      <div className="flex gap-4 mb-8">
        <button onClick={addItem} className="px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm">
          + Add Another Print
        </button>
      </div>

      <div className="relative">
        <div className="flex justify-between">
          <button
            onClick={() => { setInvoiceNumber(''); setSubmitterName(''); setNotes(''); setItems([{ ...EMPTY_ITEM }]); setHasYouthGarments(null); setYouthConfirmed(false); setError(null); setValidationToast(null) }}
            className="px-6 py-3 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            Clear / Start Over
          </button>
          <button onClick={handleSubmit} disabled={submitting}
            className="px-8 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Submitting...' : 'Submit Job'}
          </button>
        </div>        {/* Validation toast near submit button */}
        {validationToast && (
          <div className="absolute bottom-full right-0 mb-3 max-w-md animate-bounce-once">
            <div className="bg-red-600 text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <span>{validationToast}</span>
              <button onClick={() => setValidationToast(null)} className="ml-2 text-white/80 hover:text-white">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="absolute bottom-0 right-8 translate-y-1/2 w-3 h-3 bg-red-600 rotate-45"></div>
          </div>
        )}
      </div>
    </div>
  )
}

function ItemForm({ index, item, onUpdate, onFileChange, onPlacementChange, onAgeChange, onRemove, canRemove }: {
  index: number; item: SubmissionItemData; onUpdate: (i: number, u: Partial<SubmissionItemData>) => void
  onFileChange: (i: number, f: File | null) => void; onPlacementChange: (i: number, p: PlacementType) => void
  onAgeChange: (i: number, a: GarmentAge) => void; onRemove: (i: number) => void; canRemove: boolean}) {
  const validation = item.detected_width_px > 0
    ? validateItemSizing(item.detected_width_px, item.detected_height_px, item.confirmed_width_inches, item.confirmed_height_inches, item.placement, item.garment_age)
    : null
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const processFile = async (file: File | null) => {
    if (file) { setPreviewUrl(URL.createObjectURL(file)) } else { setPreviewUrl(null) }
    await onFileChange(index, file)
  }

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
        <h3 className="font-semibold">Print Item #{index + 1}</h3>
        {canRemove && <button onClick={() => onRemove(index)} className="text-sm text-red-400 hover:text-red-300">Remove</button>}
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
                  : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'              }`}
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
                X              </button>
            </div>
          )}
          {item.detected_width_px > 0 && <p className="mt-2 text-xs text-gray-500">Source: {item.detected_width_px} x {item.detected_height_px}px</p>}
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
              <label className="block text-sm text-gray-400 mb-1">Custom Placement Name *</label>              <input type="text" value={item.custom_placement_name} onChange={e => onUpdate(index, { custom_placement_name: e.target.value })}
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
              <p className="text-sm font-medium mb-2">Print Size</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Width (inches)</label>
                  <input type="number" step="0.25" min="0.5" value={item.confirmed_width_inches}
                    onChange={e => onUpdate(index, { confirmed_width_inches: parseFloat(e.target.value) || 0, size_confirmed: false })}
                    className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Height (inches)</label>
                  <input type="number" step="0.25" min="0.5" value={item.confirmed_height_inches}
                    onChange={e => onUpdate(index, { confirmed_height_inches: parseFloat(e.target.value) || 0, size_confirmed: false })}
                    className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-orange-500" />                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Suggested: {item.suggested_width_inches}&quot; x {item.suggested_height_inches}&quot;</p>
              {validation && validation.warnings.length > 0 && (
                <div className="mt-2">{validation.warnings.map((w, i) => (<p key={i} className="text-xs text-yellow-400 mt-1">{w}</p>))}</div>
              )}
              {validation && validation.errors.length > 0 && (
                <div className="mt-2">{validation.errors.map((e, i) => (<p key={i} className="text-xs text-red-400 mt-1">{e}</p>))}</div>
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