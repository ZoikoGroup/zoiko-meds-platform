import { useState, useRef } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { importCsv } from '@/services/pharmacy-api'
import { cn } from '@/lib/utils'
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, X, Loader2 } from 'lucide-react'

// Minimal CSV parse (comma-separated; first row = header).
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
  const [errorMsg, setErrorMsg] = useState('')
  const [importMode, setImportMode] = useState('merge') // 'merge' | 'replace'
  const [showConfirmModal, setShowConfirmModal] = useState(false)

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

  const handleUploadClick = () => {
    if (!parsed || parsed.error || parsed.rows.length === 0) return
    if (importMode === 'replace') {
      setShowConfirmModal(true)
    } else {
      executeUpload()
    }
  }

  const executeUpload = async () => {
    setStatus('uploading'); setProgress(30); setErrorMsg('')
    try {
      setProgress(60)
      const r = await importCsv(parsed.rows, importMode)
      setProgress(100)
      setResult(r)
      setStatus('success')
      setShowConfirmModal(false)
    } catch (err) {
      setErrorMsg(err.message || 'Upload failed. Please try again.')
      setStatus('error')
      setShowConfirmModal(false)
    }
  }

  const reset = () => {
    setFile(null)
    setParsed(null)
    setStatus('idle')
    setResult(null)
    setProgress(0)
    setErrorMsg('')
    setImportMode('merge')
    setShowConfirmModal(false)
  }

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
        <Card className="flex flex-col gap-5 p-5">
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
              {/* Import Mode Selection */}
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-4">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Import Mode</span>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                      importMode === 'merge' ? 'border-primary bg-primary/5' : 'border-border bg-card',
                    )}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value="merge"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                      className="mt-0.5 text-primary"
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-bold text-foreground">Merge Inventory (Default)</span>
                      <span className="text-[11px] leading-normal text-muted-foreground">
                        Updates matching medicines &amp; adds new items. Keeps existing unlisted inventory intact.
                      </span>
                    </div>
                  </label>

                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                      importMode === 'replace' ? 'border-danger bg-danger/5' : 'border-border bg-card',
                    )}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="mt-0.5 text-danger"
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-bold text-danger">Replace Inventory</span>
                      <span className="text-[11px] leading-normal text-muted-foreground">
                        Updates/adds items from CSV and prunes unlisted medicines for your pharmacy.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

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
              {status === 'uploading' && !showConfirmModal && (
                <div className="flex flex-col gap-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">Importing into PostgreSQL database…</span>
                </div>
              )}

              {status === 'success' && result && (
                <div className="flex flex-col gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm font-medium text-success">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 shrink-0" />
                    Inventory replaced successfully. ({result.imported} new, {result.updated} updated, {result.skipped} skipped).
                  </span>
                </div>
              )}
              {status === 'error' && (
                <p className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                  <AlertTriangle className="size-4 shrink-0" />
                  {errorMsg || 'Upload failed. Please try again.'}
                </p>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button variant="outline" onClick={reset}>Clear</Button>
                {status === 'success' ? (
                  <Button onClick={() => window.location.href = '/pharmacy/inventory'}>
                    View Inventory
                  </Button>
                ) : (
                  <Button onClick={handleUploadClick} disabled={!canUpload} variant={importMode === 'replace' ? 'destructive' : 'default'}>
                    {status === 'uploading' ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                    Upload ({importMode === 'replace' ? 'Replace Mode' : 'Merge Mode'})
                  </Button>
                )}
              </div>
            </>
          ) : null}
        </Card>
      )}

      {/* Custom Confirmation Modal for Replace Inventory Mode */}
      <Dialog open={showConfirmModal} onOpenChange={(open) => status !== 'uploading' && setShowConfirmModal(open)}>
        <DialogContent className="max-w-[480px] p-6 rounded-2xl border-border bg-card shadow-elevated">
          <DialogHeader className="flex flex-col items-center text-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
              <AlertTriangle className="size-6" />
            </div>
            <DialogTitle className="text-xl font-bold text-foreground">
              Replace Inventory?
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3.5 py-1 text-left text-sm leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">
              You are about to replace your pharmacy inventory.
            </p>

            <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3.5 text-xs text-foreground">
              <p className="font-bold text-foreground uppercase tracking-wider text-[11px]">This will:</p>
              <ul className="flex flex-col gap-1.5 text-muted-foreground">
                <li className="flex items-start gap-2 leading-tight">
                  <span className="text-foreground font-bold">•</span> Update medicines that exist in the CSV.
                </li>
                <li className="flex items-start gap-2 leading-tight">
                  <span className="text-foreground font-bold">•</span> Add new medicines from the CSV.
                </li>
                <li className="flex items-start gap-2 leading-tight">
                  <span className="text-foreground font-bold">•</span> Remove medicines that are not present in the uploaded CSV.
                </li>
              </ul>
            </div>

            <p className="text-xs font-semibold text-red-600 dark:text-red-400">
              This action cannot be undone.
            </p>
          </div>

          <DialogFooter className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
              disabled={status === 'uploading'}
              className="bg-card hover:bg-muted text-foreground border-border"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={executeUpload}
              disabled={status === 'uploading'}
              className="bg-red-600 hover:bg-red-700 text-white font-medium shadow-sm transition-colors"
            >
              {status === 'uploading' && <Loader2 className="size-4 animate-spin mr-2" />}
              Replace Inventory
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

