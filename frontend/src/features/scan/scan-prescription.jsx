import { useRef, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UploadCloud, Camera, Image as ImageIcon, ShieldCheck, MapPin, LocateFixed,
  Loader2, Pill, ArrowRight, RotateCcw, FileText, CheckCircle2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const LOC_KEY = 'zoiko-user-loc'
const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = '.jpg,.jpeg,.png,.pdf,.heic,.heif,image/jpeg,image/png,application/pdf,image/heic,image/heif'
const DISTANCES = [5, 10, 25, 50]

// Simulated on-device extraction. No image ever leaves the browser — this
// mirrors the app's other client-side mocks (e.g. voice search) until a real
// OCR/extraction service is wired in.
const SAMPLE_EXTRACTION = [
  { name: 'Dolo 650', detail: 'Paracetamol · 650 mg' },
  { name: 'Metformin 500', detail: 'Metformin · 500 mg' },
  { name: 'Pantoprazole 40', detail: 'Pantoprazole · 40 mg' },
  { name: 'Cetirizine', detail: 'Cetirizine · 10 mg' },
]

function isAcceptedFile(file) {
  if (file.size > MAX_BYTES) return { ok: false, reason: 'File is larger than 10 MB.' }
  const okType = /^(image\/(jpeg|png|heic|heif)|application\/pdf)$/.test(file.type)
  const okExt = /\.(jpe?g|png|pdf|heic|heif)$/i.test(file.name)
  if (!okType && !okExt) return { ok: false, reason: 'Use a JPG, PNG, PDF, or HEIC file.' }
  return { ok: true }
}

export function ScanPrescription({ onSearchMedicine, flash }) {
  const fileInput = useRef(null)
  const cameraInput = useRef(null)
  const galleryInput = useRef(null)

  const [dragActive, setDragActive] = useState(false)
  const [status, setStatus] = useState('idle') // idle | extracting | done
  const [fileName, setFileName] = useState('')
  const [extracted, setExtracted] = useState([])
  const [location, setLocation] = useState(() => localStorage.getItem(LOC_KEY) || '')

  useEffect(() => {
    const syncLoc = () => {
      setLocation(localStorage.getItem(LOC_KEY) || '')
    }
    window.addEventListener('storage', syncLoc)
    window.addEventListener('zoiko-location-change', syncLoc)
    return () => {
      window.removeEventListener('storage', syncLoc)
      window.removeEventListener('zoiko-location-change', syncLoc)
    }
  }, [])

  const [distance, setDistance] = useState(25)
  const [locating, setLocating] = useState(false)

  const handleFiles = (files) => {
    const file = files?.[0]
    if (!file) return
    const check = isAcceptedFile(file)
    if (!check.ok) {
      flash?.(check.reason)
      return
    }
    setFileName(file.name)
    setStatus('extracting')
    // Simulated extraction — the image is read only in-memory and discarded.
    setTimeout(() => {
      setExtracted(SAMPLE_EXTRACTION)
      setStatus('done')
    }, 1900)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }

  const reset = () => {
    setStatus('idle')
    setFileName('')
    setExtracted([])
  }

  const persistLocation = (value) => {
    setLocation(value)
    if (value) localStorage.setItem(LOC_KEY, value)
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      flash?.('Location is not supported on this device.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      () => {
        setLocating(false)
        persistLocation('Current location')
        flash?.('Using your current location.')
      },
      () => {
        setLocating(false)
        flash?.('Could not access your location. Enter it manually.')
      },
      { timeout: 8000 },
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {/* Upload / extraction surface */}
      <AnimatePresence mode="wait">
        {status === 'done' ? (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Card className="flex flex-col gap-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-success/10 text-success">
                    <CheckCircle2 className="size-5" />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-foreground">
                      {extracted.length} medicines found
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <FileText className="size-3" />
                      {fileName}
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="size-3.5" />
                  Scan another
                </Button>
              </div>

              <p className="text-sm text-muted-foreground">
                Choose which medicines to search for availability near you.
              </p>

              <ul className="flex flex-col gap-2">
                {extracted.map((m, i) => (
                  <motion.li
                    key={m.name}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/30"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal/10 text-teal">
                        <Pill className="size-4" />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold text-foreground">{m.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{m.detail}</span>
                      </span>
                    </span>
                    <Button size="sm" onClick={() => onSearchMedicine(m.name)}>
                      Search
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </motion.li>
                ))}
              </ul>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Extracted names are read from your image only. Confirm the exact medicine and
                strength with your prescription — ZoikoMeds does not validate prescriptions.
              </p>
            </Card>
          </motion.div>
        ) : status === 'extracting' ? (
          <motion.div key="extracting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card className="flex flex-col items-center justify-center gap-3 rounded-2xl border-dashed border-teal/40 bg-teal/[0.04] px-6 py-16 text-center">
              <Loader2 className="size-8 animate-spin text-teal" />
              <p className="text-base font-semibold text-foreground">Reading your prescription…</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Extracting medicine names from <span className="font-medium">{fileName}</span>. This
                happens on your device — the image is not uploaded.
              </p>
            </Card>
          </motion.div>
        ) : (
          <motion.div key="dropzone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.current?.click())}
              aria-label="Upload a prescription image"
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                dragActive ? 'border-teal bg-teal/[0.06]' : 'border-teal/40 bg-teal/[0.03] hover:border-teal/60',
              )}
            >
              <span className="flex size-14 items-center justify-center rounded-2xl bg-card text-teal shadow-soft">
                <UploadCloud className="size-6" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-lg font-bold text-foreground">Drop your prescription here</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  We&apos;ll extract the medicine names — you choose which ones to search. Your image
                  is never stored or shared.
                </p>
              </div>
              <Button
                variant="outline"
                className="border-teal/40 text-teal hover:bg-teal/5"
                onClick={(e) => { e.stopPropagation(); fileInput.current?.click() }}
              >
                <UploadCloud className="size-4" />
                Browse file
              </Button>
              <p className="text-xs text-muted-foreground">JPG, PNG, PDF, HEIC — max 10 MB</p>
            </div>

            {/* or — camera / gallery */}
            <div className="my-4 text-center text-sm text-muted-foreground">or</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button variant="outline" size="lg" className="h-12" onClick={() => cameraInput.current?.click()}>
                <Camera className="size-4" />
                Take a photo
              </Button>
              <Button variant="outline" size="lg" className="h-12" onClick={() => galleryInput.current?.click()}>
                <ImageIcon className="size-4" />
                From gallery
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden inputs */}
      <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <input ref={galleryInput} type="file" accept="image/*" className="hidden" onChange={(e) => handleFiles(e.target.files)} />

      {/* Privacy notice */}
      <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/[0.08] p-3.5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-warning" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Privacy notice:</span> Your prescription
          image is used only to extract medicine names for this search. It is{' '}
          <span className="font-semibold text-foreground">never stored, shared, or used to identify you</span>.
          ZoikoMeds does not process, validate, or fulfil prescriptions.{' '}
          <span className="font-semibold text-foreground">No medical advice is provided.</span>
        </p>
      </div>

      {/* Location + distance */}
      <div className="flex flex-col gap-2">
        <label htmlFor="scan-location" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Your location (for nearby search)
        </label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="scan-location"
            value={location}
            onChange={(e) => persistLocation(e.target.value)}
            placeholder="City, ZIP code, postcode, or current location"
            className="h-11 rounded-xl pl-10"
          />
        </div>
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className="flex w-fit items-center gap-1.5 text-sm font-semibold text-teal transition-colors hover:text-teal/80 disabled:opacity-60"
        >
          {locating ? <Loader2 className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
          Use my current location
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">Distance from me:</span>
        <select
          value={distance}
          onChange={(e) => setDistance(Number(e.target.value))}
          aria-label="Distance from me"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {DISTANCES.map((d) => (
            <option key={d} value={d}>{d} miles</option>
          ))}
        </select>
      </div>
    </div>
  )
}
