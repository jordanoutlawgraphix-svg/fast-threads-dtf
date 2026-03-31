'use client'

import { useState, useEffect } from 'react'
import { DEFAULT_SIZE_PROFILES, PLACEMENT_LABELS, DEFAULT_GANG_SHEET_CONFIG, SizeProfile, GangSheetConfig } from '@/types'
import * as store from '@/lib/store'

export default function AdminPage() {
  const [profiles, setProfiles] = useState(DEFAULT_SIZE_PROFILES)
  const [config, setConfig] = useState(DEFAULT_GANG_SHEET_CONFIG)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const [configData, profilesData] = await Promise.all([
        store.getSetting<GangSheetConfig>('gang_sheet_config'),
        store.getSetting<SizeProfile[]>('size_profiles'),
      ])
      if (configData) setConfig(configData)
      if (profilesData) setProfiles(profilesData)
    } catch {
      // Use defaults if settings table doesn't exist yet
    }
    setLoading(false)
  }

  const updateProfile = (index: number, field: string, value: number) => {
    setProfiles(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await Promise.all([
        store.saveSetting('gang_sheet_config', config),
        store.saveSetting('size_profiles', profiles),
      ])

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save settings:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading settings...</div>
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Gang Sheet Config */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 className="font-semibold mb-4">Gang Sheet Configuration</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Printable Width (in)</label>
            <input
              type="number"
              step="0.5"
              value={config.printable_width_inches}
              onChange={e => setConfig(prev => ({ ...prev, printable_width_inches: parseFloat(e.target.value) || 28 }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">DPI</label>
            <input
              type="number"
              value={config.dpi}
              onChange={e => setConfig(prev => ({ ...prev, dpi: parseInt(e.target.value) || 300 }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Item Spacing (in)</label>
            <input
              type="number"
              step="0.125"
              value={config.spacing_inches}
              onChange={e => setConfig(prev => ({ ...prev, spacing_inches: parseFloat(e.target.value) || 0.25 }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Batch Label Height (in)</label>
            <input
              type="number"
              step="0.25"
              value={config.batch_label_height_inches}
              onChange={e => setConfig(prev => ({ ...prev, batch_label_height_inches: parseFloat(e.target.value) || 0.5 }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>
      </div>

      {/* Size Profiles */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 className="font-semibold mb-4">Size Profiles</h2>
        <p className="text-sm text-gray-400 mb-4">
          These define the default print dimensions for each placement type.
          When someone submits a job, the system uses these to auto-size the print.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="py-2 text-left text-gray-400">Placement</th>
                <th className="py-2 text-left text-gray-400">Age</th>
                <th className="py-2 text-center text-gray-400">Width (in)</th>
                <th className="py-2 text-center text-gray-400">Height (in)</th>
                <th className="py-2 text-left text-gray-400">Description</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile, i) => (
                <tr key={i} className="border-b border-gray-800">
                  <td className="py-2">{PLACEMENT_LABELS[profile.placement]}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      profile.garment_age === 'youth'
                        ? 'bg-yellow-500/20 text-yellow-300'
                        : 'bg-gray-700 text-gray-300'
                    }`}>
                      {profile.garment_age}
                    </span>
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="number"
                      step="0.25"
                      min="0.5"
                      value={profile.width_inches}
                      onChange={e => updateProfile(i, 'width_inches', parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-center text-sm focus:outline-none focus:border-orange-500"
                    />
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="number"
                      step="0.25"
                      min="0.5"
                      value={profile.height_inches}
                      onChange={e => updateProfile(i, 'height_inches', parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-center text-sm focus:outline-none focus:border-orange-500"
                    />
                  </td>
                  <td className="py-2 text-xs text-gray-500">{profile.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Locations info */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 className="font-semibold mb-4">Locations</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg">
            <span className="font-mono text-orange-400 text-sm w-12">MVD</span>
            <span>Fast Threads — Montevideo, MN</span>
            <span className="text-xs text-green-400 ml-auto">Production</span>
          </div>
          <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg">
            <span className="font-mono text-orange-400 text-sm w-12">WTN</span>
            <span>Fast Threads — Watertown, SD</span>
            <span className="text-xs text-blue-400 ml-auto">Sales Office</span>
          </div>
          <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg">
            <span className="font-mono text-orange-400 text-sm w-12">DWS</span>
            <span>Jim&apos;s Clothing — Dawson, MN</span>
            <span className="text-xs text-blue-400 ml-auto">Sales Office</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
