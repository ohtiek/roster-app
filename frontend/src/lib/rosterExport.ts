import type { RosterPayload } from './types'

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function rosterToCsv(payload: RosterPayload, rosterDate: string, boutiqueName: string): string {
  const header = ['Date', 'Boutique', 'Shift', 'Staff', 'Hours', 'VIC']
  const rows = [...payload.assignments]
    .sort((a, b) => a.shift_name.localeCompare(b.shift_name) || a.staff_name.localeCompare(b.staff_name))
    .map(a => [rosterDate, boutiqueName, a.shift_name, a.staff_name, String(a.shift_duration_hours), a.is_vic_active ? 'Yes' : 'No'])
  return [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
}

// Opens a print-formatted window and triggers the browser's print dialog —
// "Save as PDF" from there is the zero-dependency path to a PDF export.
export function printRoster(payload: RosterPayload, rosterDate: string, boutiqueName: string) {
  const win = window.open('', '_blank', 'width=800,height=900')
  if (!win) return

  const byShift = new Map<string, typeof payload.assignments>()
  for (const a of payload.assignments) {
    if (!byShift.has(a.shift_name)) byShift.set(a.shift_name, [])
    byShift.get(a.shift_name)!.push(a)
  }

  const sections = [...byShift.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([shiftName, assigned]) => `
      <h3>${escapeHtml(shiftName)}</h3>
      <ul>
        ${assigned
          .sort((a, b) => a.staff_name.localeCompare(b.staff_name))
          .map(a => `<li>${escapeHtml(a.staff_name)}${a.is_vic_active ? ' <span class="vic">VIC</span>' : ''} — ${a.shift_duration_hours}h</li>`)
          .join('')}
      </ul>
    `).join('')

  win.document.write(`
    <html>
      <head>
        <title>Roster ${escapeHtml(rosterDate)}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; color: #1a1f2b; }
          h1 { font-size: 18px; margin: 0 0 0.15rem; }
          h2 { font-size: 13px; color: #6b7280; margin: 0 0 1.5rem; font-weight: 400; }
          h3 { font-size: 14px; margin: 1.25rem 0 0.4rem; border-bottom: 1px solid #e0ddd7; padding-bottom: 0.25rem; }
          ul { margin: 0; padding-left: 1.25rem; font-size: 13px; }
          li { margin-bottom: 0.25rem; }
          .vic { font-size: 10px; font-weight: 700; color: #b8973a; }
          @media print { body { padding: 0.5rem; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(boutiqueName)}</h1>
        <h2>Published roster — ${escapeHtml(rosterDate)}</h2>
        ${sections}
      </body>
    </html>
  `)
  win.document.close()
  win.focus()
  win.print()
}
