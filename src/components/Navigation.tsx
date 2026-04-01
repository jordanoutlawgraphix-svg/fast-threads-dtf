'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import * as store from '@/lib/store'

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/submit', label: 'Submit Job' },
  { href: '/queue', label: 'Print Queue' },
  { href: '/batch', label: 'Batches' },
  { href: '/history', label: 'History' },
  { href: '/admin', label: 'Settings' },
]

export function Navigation() {
  const pathname = usePathname()
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <>
      <nav className="bg-gray-900 border-b border-gray-800 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <Link href="/" className="flex items-center gap-3">
              <Image src="/logo.png" alt="Fast Threads" width={140} height={32} className="h-8 w-auto" priority />
              <span className="text-gray-500 text-sm font-light">|</span>
              <span className="font-medium text-sm text-gray-300">DTF Manager</span>
            </Link>
            <div className="flex items-center gap-1">
              {navItems.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    pathname === item.href
                      ? 'bg-orange-500/20 text-orange-400'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              <button
                onClick={() => setFeedbackOpen(true)}
                className="ml-2 px-2 py-2 text-gray-500 hover:text-orange-400 transition-colors"
                title="Report an issue or suggestion"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} currentPage={pathname} />}
    </>
  )
}

function FeedbackModal({ onClose, currentPage }: { onClose: () => void; currentPage: string }) {
  const [type, setType] = useState<'bug' | 'suggestion' | 'question'>('bug')
  const [message, setMessage] = useState('')
  const [submitterName, setSubmitterName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async () => {
    if (!message.trim()) return
    setSubmitting(true)
    try {
      await store.submitFeedback({
        type,
        message: message.trim(),
        submitter_name: submitterName.trim() || 'Anonymous',
        page: currentPage,
        user_agent: navigator.userAgent,
      })
      setSubmitted(true)
    } catch (err) {
      console.error('Feedback submit error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 no-print" onClick={onClose}>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4 text-center" onClick={e => e.stopPropagation()}>
          <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-medium mb-1">Thanks for the feedback!</p>
          <p className="text-sm text-gray-400">We'll review it and work on it.</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700">Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 no-print" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-4">Report Issue or Suggestion</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Type</label>
            <div className="flex gap-2">
              {(['bug', 'suggestion', 'question'] as const).map(t => (
                <button key={t} onClick={() => setType(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    type === t
                      ? t === 'bug' ? 'bg-red-900/40 text-red-300 border border-red-700/50'
                        : t === 'suggestion' ? 'bg-blue-900/40 text-blue-300 border border-blue-700/50'
                        : 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/50'
                      : 'bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-750'
                  }`}>
                  {t === 'bug' ? 'Bug' : t === 'suggestion' ? 'Suggestion' : 'Question'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Your Name</label>
            <input type="text" value={submitterName} onChange={e => setSubmitterName(e.target.value)} placeholder="Optional"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">What happened? *</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
              placeholder={type === 'bug' ? 'Describe what went wrong...' : type === 'suggestion' ? 'What would make this better?' : 'What do you need help with?'}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500" />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700">Cancel</button>
            <button onClick={handleSubmit} disabled={!message.trim() || submitting}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
              {submitting ? 'Sending...' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
