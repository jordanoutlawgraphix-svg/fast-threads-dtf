import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role key for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const SAVANNAH_EMAIL = process.env.SAVANNAH_EMAIL || ''
const CRON_SECRET = process.env.CRON_SECRET || ''

function getServerSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey)
}

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized triggers
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  }
  if (!SAVANNAH_EMAIL) {
    return NextResponse.json({ error: 'SAVANNAH_EMAIL not configured' }, { status: 500 })
  }
  try {
    const supabase = getServerSupabase()
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

    // Get all unbatched items (in the print queue)
    const { data: batchedIds } = await supabase.from('batch_items').select('job_item_id')
    const batchedSet = new Set((batchedIds || []).map((b: { job_item_id: string }) => b.job_item_id))

    const { data: allItems } = await supabase
      .from('job_items')
      .select('*, jobs(*)')
      .order('created_at', { ascending: false })

    const queueItems = (allItems || [])
      .filter((item: { id: string; jobs: { status: string } }) =>
        !batchedSet.has(item.id) &&
        item.jobs &&
        ['submitted', 'reviewed', 'queued'].includes((item.jobs as { status: string }).status)
      )

    // Get batches that are ready but not printed
    const { data: readyBatches } = await supabase
      .from('batches')
      .select('*, batch_items(count)')
      .eq('status', 'ready')
      .order('batch_number', { ascending: true })
    // Split queue items into new (submitted today) vs carried over
    const newItems = queueItems.filter((item: { created_at: string }) => item.created_at >= todayStart)
    const carriedOver = queueItems.filter((item: { created_at: string }) => item.created_at < todayStart)

    // Calculate total prints (sum of quantities)
    const totalPrints = queueItems.reduce((sum: number, item: { quantity: number }) => sum + (item.quantity || 1), 0)
    const newPrints = newItems.reduce((sum: number, item: { quantity: number }) => sum + (item.quantity || 1), 0)
    const carriedPrints = carriedOver.reduce((sum: number, item: { quantity: number }) => sum + (item.quantity || 1), 0)

    // Build email HTML
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #f97316; color: white; padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; }
    .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
    .content { padding: 24px; }
    .stat-grid { display: flex; gap: 12px; margin-bottom: 24px; }
    .stat-box { flex: 1; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }    .stat-box .number { font-size: 28px; font-weight: bold; color: #1f2937; }
    .stat-box .label { font-size: 12px; color: #6b7280; text-transform: uppercase; margin-top: 4px; }
    .section { margin-bottom: 20px; }
    .section h2 { font-size: 16px; color: #374151; margin: 0 0 12px; border-bottom: 2px solid #f97316; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f9fafb; text-align: left; padding: 8px 12px; color: #6b7280; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
    td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; color: #374151; }
    .badge-new { background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge-carried { background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .footer { background: #f9fafb; padding: 16px 24px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
    .empty-state { text-align: center; padding: 32px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Good Morning, Savannah!</h1>
      <p>${dateStr} — Daily Print Queue Summary</p>
    </div>
    <div class="content">
      <div class="stat-grid">
        <div class="stat-box">
          <div class="number">${queueItems.length}</div>
          <div class="label">Jobs in Queue</div>
        </div>        <div class="stat-box">
          <div class="number">${totalPrints}</div>
          <div class="label">Total Prints</div>
        </div>
        <div class="stat-box">
          <div class="number">${(readyBatches || []).length}</div>
          <div class="label">Batches Ready</div>
        </div>
      </div>

      ${queueItems.length === 0 ? `
        <div class="empty-state">
          <p style="font-size: 32px; margin: 0;">&#127881;</p>
          <p>Queue is clear! No prints waiting.</p>
        </div>
      ` : `
        ${newItems.length > 0 ? `
        <div class="section">
          <h2>New Today (${newPrints} prints)</h2>
          <table>
            <tr><th>Invoice</th><th>Placement</th><th>Size</th><th>Qty</th></tr>
            ${newItems.map((item: { jobs: { invoice_number: string }; placement: string; target_width_inches: number; target_height_inches: number; quantity: number }) => `
              <tr>
                <td>${(item.jobs as { invoice_number: string }).invoice_number}</td>                <td>${item.placement}</td>
                <td>${item.target_width_inches}" x ${item.target_height_inches}"</td>
                <td>${item.quantity}</td>
              </tr>
            `).join('')}
          </table>
        </div>
        ` : ''}

        ${carriedOver.length > 0 ? `
        <div class="section">
          <h2>Carried Over (${carriedPrints} prints)</h2>
          <table>
            <tr><th>Invoice</th><th>Placement</th><th>Size</th><th>Qty</th><th>Waiting Since</th></tr>
            ${carriedOver.map((item: { jobs: { invoice_number: string }; placement: string; target_width_inches: number; target_height_inches: number; quantity: number; created_at: string }) => `
              <tr>
                <td>${(item.jobs as { invoice_number: string }).invoice_number}</td>
                <td>${item.placement}</td>
                <td>${item.target_width_inches}" x ${item.target_height_inches}"</td>
                <td>${item.quantity}</td>
                <td>${new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
              </tr>
            `).join('')}
          </table>
        </div>        ` : ''}
      `}

      ${(readyBatches || []).length > 0 ? `
      <div class="section">
        <h2>Batches Ready to Print</h2>
        <table>
          <tr><th>Batch #</th><th>Items</th><th>Sheet Size</th></tr>
          ${(readyBatches || []).map((batch: { batch_number: number; batch_items: { count: number }[]; sheet_width_inches: number; sheet_height_inches: number }) => `
            <tr>
              <td><strong>Batch ${batch.batch_number}</strong></td>
              <td>${batch.batch_items?.[0]?.count || '—'}</td>
              <td>${batch.sheet_width_inches || 28}" x ${batch.sheet_height_inches || '—'}"</td>
            </tr>
          `).join('')}
        </table>
      </div>
      ` : ''}
    </div>
    <div class="footer">
      Fast Threads Inc. — DTF Workflow Manager
    </div>
  </div>
</body>
</html>`
    // Send via Resend
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Fast Threads DTF <dtf@fastthreadsinc.com>',
        to: [SAVANNAH_EMAIL],
        subject: `DTF Queue: ${totalPrints} prints waiting — ${dateStr}`,
        html: emailHtml,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      console.error('Resend error:', result)
      return NextResponse.json({ error: 'Failed to send email', details: result }, { status: 500 })
    }

    return NextResponse.json({
      success: true,      summary: {
        queue_items: queueItems.length,
        total_prints: totalPrints,
        new_today: newItems.length,
        carried_over: carriedOver.length,
        ready_batches: (readyBatches || []).length,
      },
      email_id: result.id,
    })
  } catch (err) {
    console.error('Morning email error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}