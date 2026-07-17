import { useState, useRef } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { importCsv } from '@/services/pharmacy-api'
import { cn } from '@/lib/utils'
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, X, Loader2 } from 'lucide-react'

// Minimal CSV parse (comma-separated; first row = header).
// TODO(backend): POST the raw file to /pharmacy/inventory/import instead of
// parsing client-side, and stream real upload progress.
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return { headers: [], rows: [], error: 'The file is empty.' }
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  if (!headers.includes('name')) return { headers, rows: [], error: 'Missing required “name” column.' }
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row = {}
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
  return { headers, rows, error: null }
}

export default function PharmacyUpload() {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('idle') // idle | uploading | success | error
  const [result, setResult] = useState(null)

  const handleFile = (f) => {
    setStatus('idle'); setResult(null); setProgress(0)
    if (!f) return
    setFile(f)
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setParsed({ headers: [], rows: [], error: 'Please upload a .csv file.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setParsed(parseCsv(String(reader.result)))
    reader.onerror = () => setParsed({ headers: [], rows: [], error: 'Could not read the file.' })
    reader.readAsText(f)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  const upload = async () => {
    if (!parsed || parsed.error || parsed.rows.length === 0) return
    setStatus('uploading'); setProgress(0)
    await new Promise((res) => {
      let p = 0
      const t = setInterval(() => {
        p += 12; setProgress(Math.min(100, p))
        if (p >= 100) { clearInterval(t); res() }
      }, 90)
    })
    try {
      const r = await importCsv(parsed.rows)
      setResult(r); setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  const reset = () => { setFile(null); setParsed(null); setStatus('idle'); setResult(null); setProgress(0) }

  const canUpload = parsed && !parsed.error && parsed.rows.length > 0 && status !== 'uploading'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="CSV upload"
        subtitle="Bulk-import or update your inventory from a CSV file."
      />

      {/* Dropzone */}
      <Card
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border',
        )}
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <UploadCloud className="size-7" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">Drag &amp; drop your CSV here</p>
          <p className="text-xs text-muted-foreground">or click to browse. Columns: name, generic, strength, dosageform, status</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <FileText className="size-4" />
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </Card>

      {/* Selected file + validation */}
      {file && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText className="size-4 text-primary" />
              {file.name}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Remove file" onClick={reset}>
              <X className="size-4" />
            </Button>
          </div>

          {parsed?.error ? (
            <p className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
              <AlertTriangle className="size-4" />
              {parsed.error}
            </p>
          ) : parsed ? (
            <>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="size-4 text-success" />
                {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} parsed · previewing first {Math.min(8, parsed.rows.length)}
              </p>

              {/* Preview */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      {parsed.headers.map((h) => (
                        <th key={h} className="px-3 py-2 font-semibold capitalize">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        {parsed.headers.map((h) => (
                          <td key={h} className="px-3 py-2 text-foreground">{r[h] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Progress */}
              {status === 'uploading' && (
                <div className="flex flex-col gap-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">Uploading… {progress}%</span>
                </div>
              )}

              {status === 'success' && result && (
                <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success">
                  <CheckCircle2 className="size-4" />
                  Uploaded {result.imported} medicines{result.skipped ? `, ${result.skipped} skipped` : ''}.
                </p>
              )}
              {status === 'error' && (
                <p className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                  <AlertTriangle className="size-4" />
                  Upload failed. Please try again.
                </p>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button variant="outline" onClick={reset}>Clear</Button>
                <Button onClick={upload} disabled={!canUpload}>
                  {status === 'uploading' ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                  Upload {parsed.rows.length} medicines
                </Button>
              </div>
            </>
          ) : null}
        </Card>
      )}
    </div>
  )
}
