// ============================================
// Auto-Sizing Engine
// ============================================
// Calculates target print dimensions based on placement type and garment age.
// Validates source file resolution against target size.
// Handles the adult→youth auto-resize logic.

import { PlacementType, GarmentAge, DEFAULT_SIZE_PROFILES, SizeProfile } from '@/types'

interface SizingResult {
  target_width_inches: number
  target_height_inches: number
  source_dpi_at_target: number
  quality_warning: string | null
  auto_resized: boolean
}

/**
 * Get the size profile for a given placement and garment age
 */
export function getSizeProfile(
  placement: PlacementType,
  garmentAge: GarmentAge,
  customProfiles?: Omit<SizeProfile, 'id'>[]
): Omit<SizeProfile, 'id'> | null {
  const profiles = customProfiles || DEFAULT_SIZE_PROFILES
  return profiles.find(p => p.placement === placement && p.garment_age === garmentAge) || null
}

/**
 * Calculate the target print size for a file given its dimensions and the desired placement
 */
export function calculateTargetSize(
  sourceWidthPx: number,
  sourceHeightPx: number,
  sourceDpi: number,
  placement: PlacementType,
  garmentAge: GarmentAge,
  customProfiles?: Omit<SizeProfile, 'id'>[]
): SizingResult {
  const profile = getSizeProfile(placement, garmentAge, customProfiles)

  if (!profile) {
    return {
      target_width_inches: sourceWidthPx / sourceDpi,
      target_height_inches: sourceHeightPx / sourceDpi,
      source_dpi_at_target: sourceDpi,
      quality_warning: 'No size profile found for this placement. Using source dimensions.',
      auto_resized: false,
    }
  }

  const maxWidth = profile.width_inches
  const maxHeight = profile.height_inches

  // Calculate source size in inches at native DPI
  const sourceWidthInches = sourceWidthPx / (sourceDpi || 300)
  const sourceHeightInches = sourceHeightPx / (sourceDpi || 300)

  // Scale to fit within the profile dimensions while maintaining aspect ratio
  const sourceAspect = sourceWidthPx / sourceHeightPx
  const profileAspect = maxWidth / maxHeight

  let targetWidth: number
  let targetHeight: number

  if (sourceAspect > profileAspect) {
    // Source is wider proportionally - constrain by width
    targetWidth = maxWidth
    targetHeight = maxWidth / sourceAspect
  } else {
    // Source is taller proportionally - constrain by height
    targetHeight = maxHeight
    targetWidth = maxHeight * sourceAspect
  }

  // Calculate effective DPI at the target size
  const effectiveDpi = sourceWidthPx / targetWidth

  // Quality check
  let qualityWarning: string | null = null
  if (effectiveDpi < 150) {
    qualityWarning = `WARNING: Image resolution is very low (${Math.round(effectiveDpi)} DPI at print size). Minimum recommended is 300 DPI. This will look pixelated.`
  } else if (effectiveDpi < 300) {
    qualityWarning = `CAUTION: Image resolution is ${Math.round(effectiveDpi)} DPI at print size. 300 DPI recommended for best quality.`
  }

  return {
    target_width_inches: Math.round(targetWidth * 100) / 100,
    target_height_inches: Math.round(targetHeight * 100) / 100,
    source_dpi_at_target: Math.round(effectiveDpi),
    quality_warning: qualityWarning,
    auto_resized: true,
  }
}

/**
 * Given an adult-sized file, calculate the youth dimensions
 * This is the key function that prevents the "adult fits youth" problem
 */
export function calculateYouthFromAdult(
  adultWidthInches: number,
  adultHeightInches: number,
  placement: PlacementType,
  customProfiles?: Omit<SizeProfile, 'id'>[]
): { width: number; height: number; scale_factor: number } {
  const adultProfile = getSizeProfile(placement, 'adult', customProfiles)
  const youthProfile = getSizeProfile(placement, 'youth', customProfiles)

  if (!adultProfile || !youthProfile) {
    // Default to 75% scale if no profiles
    return {
      width: Math.round(adultWidthInches * 0.75 * 100) / 100,
      height: Math.round(adultHeightInches * 0.75 * 100) / 100,
      scale_factor: 0.75,
    }
  }

  // Calculate scale based on the ratio between youth and adult max dimensions
  const widthScale = youthProfile.width_inches / adultProfile.width_inches
  const heightScale = youthProfile.height_inches / adultProfile.height_inches
  const scaleFactor = Math.min(widthScale, heightScale)

  return {
    width: Math.round(adultWidthInches * scaleFactor * 100) / 100,
    height: Math.round(adultHeightInches * scaleFactor * 100) / 100,
    scale_factor: Math.round(scaleFactor * 100) / 100,
  }
}

/**
 * Detect image dimensions from a File object (client-side)
 */
export function detectImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

/**
 * Validate a submission item's sizing
 */
export interface SizeValidation {
  valid: boolean
  warnings: string[]
  errors: string[]
}

export function validateItemSizing(
  sourceWidthPx: number,
  sourceHeightPx: number,
  targetWidthInches: number,
  targetHeightInches: number,
  placement: PlacementType,
  garmentAge: GarmentAge,
): SizeValidation {
  const warnings: string[] = []
  const errors: string[] = []

  // Check minimum source resolution
  const effectiveDpi = sourceWidthPx / targetWidthInches
  if (effectiveDpi < 100) {
    errors.push(`Image is too low resolution for this print size (${Math.round(effectiveDpi)} DPI). Minimum 150 DPI required.`)
  } else if (effectiveDpi < 150) {
    warnings.push(`Low resolution (${Math.round(effectiveDpi)} DPI). May look pixelated. 300 DPI recommended.`)
  } else if (effectiveDpi < 300) {
    warnings.push(`Acceptable resolution (${Math.round(effectiveDpi)} DPI) but 300 DPI recommended for best quality.`)
  }

  // Check if dimensions seem reasonable for placement
  const profile = getSizeProfile(placement, garmentAge)
  if (profile) {
    if (targetWidthInches > profile.width_inches * 1.1) {
      warnings.push(`Width (${targetWidthInches}") exceeds recommended max for ${profile.label} (${profile.width_inches}").`)
    }
    if (targetHeightInches > profile.height_inches * 1.1) {
      warnings.push(`Height (${targetHeightInches}") exceeds recommended max for ${profile.label} (${profile.height_inches}").`)
    }
  }

  // Check for very small prints
  if (targetWidthInches < 1 || targetHeightInches < 1) {
    warnings.push('Print is very small (under 1"). Double check this is correct.')
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  }
}
