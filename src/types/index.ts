// ============================================
// Fast Threads DTF Workflow Manager - Types
// ============================================

export type PlacementType =
  | 'left_chest'
  | 'full_front'
  | 'full_back'
  | 'sleeve_left'
  | 'sleeve_right'
  | 'numbers'
  | 'names'
  | 'custom'

export type GarmentAge = 'adult' | 'youth'

export type JobStatus = 'submitted' | 'reviewed' | 'queued' | 'batched' | 'printed' | 'complete'

export type BatchStatus = 'building' | 'ready' | 'printing' | 'printed' | 'complete'

export interface SizeProfile {
  id: string
  placement: PlacementType
  garment_age: GarmentAge
  width_inches: number
  height_inches: number
  label: string
  description: string
}

export interface Location {
  id: string
  name: string
  code: string // e.g., 'MVD', 'WTN', 'DWS'
}

export interface JobSubmission {
  id: string
  invoice_number: string
  location_id: string
  location_code: string
  submitter_name: string
  created_at: string
  status: JobStatus
  notes: string | null
  is_rush: boolean
  due_date: string | null
}

export interface JobItem {
  id: string
  job_id: string
  placement: PlacementType
  garment_age: GarmentAge
  quantity: number
  original_filename: string
  file_path: string
  thumbnail_path: string | null
  // Source file dimensions. PDFs are vector — these values are the 300 DPI
  // equivalent derived from the PDF's native point dimensions (width_inches * 300).
  // The sizing engine treats these as pixel counts at source_dpi for validation,
  // which works out correctly for vector input.
  source_width_px: number
  source_height_px: number
  source_dpi: number
  // Target print dimensions (inches) — what actually prints
  target_width_inches: number
  target_height_inches: number
  // Was the size auto-calculated or manually overridden?
  size_auto: boolean
  size_confirmed: boolean
  // Custom placement name (only if placement === 'custom')
  custom_placement_name: string | null
  notes: string | null
}

export interface Batch {
  id: string
  batch_number: number
  created_at: string
  status: BatchStatus
  total_items: number
  gang_sheet_path: string | null
  summary_pdf_path: string | null
  notes: string | null
}

export interface BatchItem {
  id: string
  batch_id: string
  job_item_id: string
  // Position on gang sheet (inches from top-left)
  x_position: number
  y_position: number
  print_width: number
  print_height: number
  job_item?: JobItem
  job?: JobSubmission
}

// NOTE: Gang sheet layout is now handled inside NeoStampa (native nesting
// + step-and-repeat). This app stages PDFs for NeoStampa to pull; it does
// not compute layout. The legacy GangSheetConfig type has been removed.

// For the submission form
export interface SubmissionFormData {
  invoice_number: string
  location_id: string
  submitter_name: string
  notes: string
  items: SubmissionItemData[]
}

export interface SubmissionItemData {
  file: File | null
  placement: PlacementType
  garment_age: GarmentAge
  quantity: number
  custom_placement_name: string
  // Populated after file upload
  detected_width_px: number
  detected_height_px: number
  suggested_width_inches: number
  suggested_height_inches: number
  confirmed_width_inches: number
  confirmed_height_inches: number
  size_confirmed: boolean
}

// Default size profiles - industry standard
export const DEFAULT_SIZE_PROFILES: Omit<SizeProfile, 'id'>[] = [
  { placement: 'left_chest', garment_age: 'adult', width_inches: 4, height_inches: 4, label: 'Left Chest (Adult)', description: '4" x 4" standard left chest' },
  { placement: 'left_chest', garment_age: 'youth', width_inches: 3, height_inches: 3, label: 'Left Chest (Youth)', description: '3" x 3" youth left chest' },
  { placement: 'full_front', garment_age: 'adult', width_inches: 12, height_inches: 14, label: 'Full Front (Adult)', description: '12" x 14" full front' },
  { placement: 'full_front', garment_age: 'youth', width_inches: 9, height_inches: 10.5, label: 'Full Front (Youth)', description: '9" x 10.5" youth front (~75%)' },
  { placement: 'full_back', garment_age: 'adult', width_inches: 12, height_inches: 14, label: 'Full Back (Adult)', description: '12" x 14" full back' },
  { placement: 'full_back', garment_age: 'youth', width_inches: 9, height_inches: 10.5, label: 'Full Back (Youth)', description: '9" x 10.5" youth back (~75%)' },
  { placement: 'sleeve_left', garment_age: 'adult', width_inches: 3.5, height_inches: 12, label: 'Sleeve Left (Adult)', description: '3.5" x 12" left sleeve' },
  { placement: 'sleeve_left', garment_age: 'youth', width_inches: 2.5, height_inches: 9, label: 'Sleeve Left (Youth)', description: '2.5" x 9" youth left sleeve' },
  { placement: 'sleeve_right', garment_age: 'adult', width_inches: 3.5, height_inches: 12, label: 'Sleeve Right (Adult)', description: '3.5" x 12" right sleeve' },
  { placement: 'sleeve_right', garment_age: 'youth', width_inches: 2.5, height_inches: 9, label: 'Sleeve Right (Youth)', description: '2.5" x 9" youth right sleeve' },
  { placement: 'numbers', garment_age: 'adult', width_inches: 10, height_inches: 12, label: 'Numbers (Adult)', description: '10" x 12" jersey numbers' },
  { placement: 'numbers', garment_age: 'youth', width_inches: 8, height_inches: 10, label: 'Numbers (Youth)', description: '8" x 10" youth numbers' },
  { placement: 'names', garment_age: 'adult', width_inches: 12, height_inches: 3, label: 'Names (Adult)', description: '12" x 3" name bar' },
  { placement: 'names', garment_age: 'youth', width_inches: 9, height_inches: 2.5, label: 'Names (Youth)', description: '9" x 2.5" youth name bar' },
  { placement: 'custom', garment_age: 'adult', width_inches: 10, height_inches: 10, label: 'Custom (Adult)', description: 'Custom placement - set dimensions manually' },
  { placement: 'custom', garment_age: 'youth', width_inches: 7.5, height_inches: 7.5, label: 'Custom (Youth)', description: 'Custom placement youth - set dimensions manually' },
]

export const PLACEMENT_LABELS: Record<PlacementType, string> = {
  left_chest: 'Left Chest',
  full_front: 'Full Front',
  full_back: 'Full Back',
  sleeve_left: 'Left Sleeve',
  sleeve_right: 'Right Sleeve',
  numbers: 'Numbers',
  names: 'Names',
  custom: 'Custom',
}

export const LOCATIONS: Location[] = [
  { id: '41bfb0ef-47a3-4dbe-b744-fe50fbc3ed43', name: 'Fast Threads - Montevideo', code: 'MVD' },
  { id: '9089288c-bf33-4446-8752-b2a49766df79', name: 'Fast Threads - Watertown', code: 'WTN' },
  { id: '35a7a311-d45d-4868-a2eb-f5b1e1bdaa4f', name: "Jim's Clothing - Dawson", code: 'DWS' },
]
