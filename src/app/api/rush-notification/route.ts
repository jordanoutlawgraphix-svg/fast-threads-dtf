import { NextRequest, NextResponse } from 'next/server'

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const SAVANNAH_EMAIL = process.env.SAVANNAH_EMAIL || ''

export async function POST(request: NextRequest) {
  if (!RESEND_API_KEY || !SAVANNAH_EMAIL) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
  }

  try {
    const body = await request.json()
    const { invoice_number, submitter_name, location_name, due_date, item_count, total_prints, notes } = body

    const dueDateFormatted = new Date(due_date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #dc2626; color: white; padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
    .content { padding: 24px; }
    .detail { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f3f4f6; }
    .detail-label { color: #6b7280; font-size: 14px; }
    .detail-value { color: #1f2937; font-weight: 600; font-size: 14px; }
    .due-date { background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0; }
    .due-date .label { color: #991b1b; font-size: 12px; text-transform: uppercase; font-weight: 600; }
    .due-date .date { color: #dc2626; font-size: 20px; font-weight: bold; margin-top: 4px; }
    .notes { background: #f9fafb; border-radius: 8px; padding: 12px; margin-top: 16px; font-size: 13px; color: #374151; }
    .footer { background: #f9fafb; padding: 16px 24px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>RUSH JOB</h1>
      <p>A priority order has just been submitted</p>
    </div>
    <div class="content">
      <div class="due-date">
        <div class="label">Due Date</div>        <div class="date">${dueDateFormatted}</div>
      </div>
      <div class="detail">
        <span class="detail-label">Invoice</span>
        <span class="detail-value">${invoice_number}</span>
      </div>
      <div class="detail">
        <span class="detail-label">Submitted By</span>
        <span class="detail-value">${submitter_name}</span>
      </div>
      <div class="detail">
        <span class="detail-label">Location</span>
        <span class="detail-value">${location_name}</span>
      </div>
      <div class="detail">
        <span class="detail-label">Print Items</span>
        <span class="detail-value">${item_count} item${item_count !== 1 ? 's' : ''}</span>
      </div>
      <div class="detail" style="border-bottom: none;">
        <span class="detail-label">Total Prints</span>
        <span class="detail-value">${total_prints}</span>
      </div>
      ${notes ? `<div class="notes"><strong>Notes:</strong> ${notes}</div>` : ''}
    </div>
    <div class="footer">      Fast Threads Inc. — DTF Workflow Manager
    </div>
  </div>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Fast Threads DTF <dtf@fastthreadsinc.com>',
        to: [SAVANNAH_EMAIL],
        subject: `RUSH JOB: ${invoice_number} — Due ${dueDateFormatted}`,
        html: emailHtml,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      console.error('Resend error:', result)
      return NextResponse.json({ error: 'Failed to send rush notification', details: result }, { status: 500 })    }

    return NextResponse.json({ success: true, email_id: result.id })
  } catch (err) {
    console.error('Rush notification error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}