import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UploadCloud, Camera, Image as ImageIcon, ShieldCheck, MapPin, LocateFixed,
  Loader2, Pill, ArrowRight, RotateCcw, FileText, CheckCircle2, AlertTriangle,
  HelpCircle, Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const LOC_KEY = 'zoiko-user-loc'
const MAX_BYTES = 10 * 1024 * 1024
// HEIC/HEIF is deliberately absent: browsers cannot decode it to a canvas and
// Tesseract cannot read it, so accepting one produced a silent "0 medicines
// found". iOS converts to JPEG automatically for the camera/gallery inputs.
const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf'
// Kilometres, matching the Search Medicines radius selector and the API,
// which has always taken `maxDistance` as a km ceiling.
const DISTANCES_KM = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]

import {
  extractPrescriptionMeds,
  mergeVisionResults,
  UnsupportedFormatError,
} from './extract-prescription'
import {
  MAX_FALLBACK_IMAGES,
  extractWithVision,
  fileToDataUrl,
  isVisionFallbackAvailable,
} from './vision-fallback'
import { renderPdfPageImages } from './pdf-text'
import { terminateOcrWorker } from './ocr-worker'
import { useLanguage } from '@/providers/language-provider'

const isPdfFile = (file) =>
  file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name ?? '')

function isAcceptedFile(file) {
  if (file.size > MAX_BYTES) {
    return { ok: false, reasonKey: 'fileTooLarge', reason: 'File is larger than 10 MB.' }
  }
  if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) {
    return {
      ok: false,
      reasonKey: 'heicNotReadable',
      reason:
        'HEIC photos cannot be read in the browser. Use “Take a photo” below, or re-save the image as JPG or PNG.',
    }
  }
  const okType = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)
  const okExt = /\.(jpe?g|png|webp|pdf)$/i.test(file.name)
  if (!okType && !okExt) {
    return { ok: false, reasonKey: 'unsupportedFileType', reason: 'Use a JPG, PNG, WebP, or PDF file.' }
  }
  return { ok: true }
}

/**
 * @param onSearchMedicine  called with the chosen medicine object.
 * @param onDetected        called with the full detected list whenever it
 *                          changes, so the page can keep the medicines
 *                          selectable after the user moves to the search view.
 *                          Must be referentially stable (useCallback).
 */
export function ScanPrescription({ onSearchMedicine, onDetected, flash }) {
  const { t } = useLanguage()
  const fileInput = useRef(null)
  const cameraInput = useRef(null)
  const galleryInput = useRef(null)
  const lastFile = useRef(null)

  const [dragActive, setDragActive] = useState(false)
  // idle | preparing | reading | matching | done | failed
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [confirmed, setConfirmed] = useState(() => new Set())
  const [visionAvailable, setVisionAvailable] = useState(false)
  const [visionRunning, setVisionRunning] = useState(false)
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

  // Release the OCR worker's WASM heap when the user navigates away.
  useEffect(() => () => { void terminateOcrWorker() }, [])

  // Publish the detected list upward so it stays selectable from the search
  // view — the user should never have to re-scan to reach the next medicine.
  useEffect(() => {
    onDetected?.(result?.medicines ?? [])
  }, [result, onDetected])

  useEffect(() => {
    let cancelled = false
    isVisionFallbackAvailable().then((available) => {
      if (!cancelled) setVisionAvailable(available)
    })
    return () => { cancelled = true }
  }, [])

  const [distance, setDistance] = useState(25)
  const [locating, setLocating] = useState(false)

  const handleFiles = async (files) => {
    const file = files?.[0]
    if (!file) return
    const check = isAcceptedFile(file)
    if (!check.ok) {
      flash?.(t(check.reasonKey, check.reason))
      return
    }

    lastFile.current = file
    setFileName(file.name)
    setErrorMessage('')
    setResult(null)
    setConfirmed(new Set())
    setStatus('preparing')

    try {
      const extraction = await extractPrescriptionMeds(file, {
        onProgress: (update) => {
          setProgress(update)
          if (update.phase === 'matching') setStatus('matching')
          else if (update.phase !== 'preparing') setStatus('reading')
        },
      })
      setResult(extraction)
      setStatus('done')
      extraction.warnings.forEach((warning) => flash?.(warning))
    } catch (err) {
      console.error('Prescription extraction failed:', err)
      setErrorMessage(
        err instanceof UnsupportedFormatError
          ? err.message
          : (err?.message ?? 'Something went wrong while reading your prescription.'),
      )
      setStatus('failed')
    } finally {
      setProgress(null)
    }
  }

  const runVisionFallback = async () => {
    if (!result || visionRunning) return
    setVisionRunning(true)
    try {
      let images = result.pageImages ?? []
      if (!images.length && lastFile.current) {
        // A PDF whose text layer read cleanly was never rasterized, so there was
        // nothing to send and assisted reading simply refused. Render the pages
        // now — only the ones that will be sent, and only because the user asked.
        images = isPdfFile(lastFile.current)
          ? await renderPdfPageImages(lastFile.current, { maxPages: MAX_FALLBACK_IMAGES })
          : [await fileToDataUrl(lastFile.current)]
      }
      if (!images.length) {
        flash?.('There is no page image available for assisted reading.')
        return
      }
      const medicines = await extractWithVision(images)
      if (!medicines.length) {
        flash?.('Assisted reading could not identify any medicines either.')
        return
      }
      setResult((current) => (current ? mergeVisionResults(current, medicines) : current))
    } catch (err) {
      flash?.(err?.message ?? 'Assisted reading is unavailable right now.')
    } finally {
      setVisionRunning(false)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }

  const reset = () => {
    setStatus('idle')
    setFileName('')
    setResult(null)
    setErrorMessage('')
    setProgress(null)
    setConfirmed(new Set())
    lastFile.current = null
  }

  const confirmMedicine = (name) => {
    setConfirmed((current) => new Set(current).add(name))
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

  const busy = status === 'preparing' || status === 'reading' || status === 'matching'
  const statusLabel =
    status === 'preparing'
      ? t('processingPrescription', 'Processing prescription…')
      : status === 'matching'
        ? t('matchingMedicines', 'Matching medicines…')
        : t('readingPrescription', 'Reading your prescription…')

  const progressDetail = (() => {
    if (!progress) return ''
    if (progress.phase === 'ocr' && progress.totalPages > 1) {
      return `Page ${progress.page} of ${progress.totalPages} · ${Math.round((progress.progress ?? 0) * 100)}%`
    }
    if (progress.phase === 'ocr') return `${Math.round((progress.progress ?? 0) * 100)}%`
    if (progress.phase === 'page') return `Page ${progress.page} of ${progress.totalPages}`
    return ''
  })()

  const renderMedicine = (medicine, { requireConfirm }) => {
    const isConfirmed = confirmed.has(medicine.name)
    return (
      <motion.li
        key={medicine.name}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        className={cn(
          'flex items-center justify-between gap-3 rounded-xl border bg-card p-3 transition-colors',
          requireConfirm && !isConfirmed
            ? 'border-warning/40 hover:border-warning/60'
            : 'border-border hover:border-primary/30',
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg',
              requireConfirm && !isConfirmed ? 'bg-warning/10 text-warning' : 'bg-teal/10 text-teal',
            )}
          >
            {requireConfirm && !isConfirmed ? <HelpCircle className="size-4" /> : <Pill className="size-4" />}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">{medicine.name}</span>
            <span className="truncate text-xs text-muted-foreground">{medicine.detail}</span>
            {requireConfirm && (
              <span className="truncate text-[11px] text-warning">{medicine.reason}</span>
            )}
          </span>
        </span>
        {requireConfirm && !isConfirmed ? (
          <Button size="sm" variant="outline" onClick={() => confirmMedicine(medicine.name)}>
            {t('confirm', 'Confirm')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => onSearchMedicine?.(medicine)}>
            {t('search', 'Search')}
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </motion.li>
    )
  }

  const hasAnyResult = result && result.medicines.length > 0

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
                  <span
                    className={cn(
                      'flex size-9 items-center justify-center rounded-xl',
                      hasAnyResult ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
                    )}
                  >
                    {hasAnyResult ? <CheckCircle2 className="size-5" /> : <AlertTriangle className="size-5" />}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-foreground">
                      {hasAnyResult
                        ? `${result.medicines.length} ${t('medicinesFound', 'medicines found')}`
                        : t('noMedicinesConfident', 'Could not confidently identify medicines')}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <FileText className="size-3" />
                      {fileName}
                      {result.stats.pages > 1 ? ` · ${result.stats.pages} pages` : ''}
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="size-3.5" />
                  {t('scanAnother', 'Scan another')}
                </Button>
              </div>

              {result.confident.length > 0 && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t('chooseMedicinesToSearch', 'Choose which medicines to search for availability near you.')}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {result.confident.map((medicine) => renderMedicine(medicine, { requireConfirm: false }))}
                  </ul>
                </>
              )}

              {result.unconfirmed.length > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-1">
                    <HelpCircle className="size-4 text-warning" />
                    <p className="text-sm font-semibold text-foreground">
                      {t('pleaseConfirmDetected', 'Please confirm the detected medicine')}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'lowConfidenceNotice',
                      'These were read with lower certainty. Check each against your prescription before searching.',
                    )}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {result.unconfirmed.map((medicine) => renderMedicine(medicine, { requireConfirm: true }))}
                  </ul>
                </>
              )}

              {!hasAnyResult && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'noMedicinesHelp',
                    'The text on this file could not be matched to any medicine. Try a sharper, well-lit photo of the prescription, or upload the original PDF.',
                  )}
                </p>
              )}

              {result.needsVisionFallback && visionAvailable && !result.visionUsed && (
                <div className="flex flex-col gap-2 rounded-xl border border-teal/30 bg-teal/[0.04] p-3.5">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Sparkles className="size-4 text-teal" />
                    {t('tryAssistedReading', 'Try assisted reading')}
                  </span>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t(
                      'assistedReadingNotice',
                      'On-device reading could not identify the medicines with confidence. Assisted reading sends the prescription image to the ZoikoMeds server for a second attempt. The image is used only for this extraction and is not stored.',
                    )}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit border-teal/40 text-teal hover:bg-teal/5"
                    onClick={runVisionFallback}
                    disabled={visionRunning}
                  >
                    {visionRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    {visionRunning
                      ? t('readingPrescriptionShort', 'Reading…')
                      : t('uploadAndRead', 'Upload image and read')}
                  </Button>
                </div>
              )}

              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('extractedNamesNotice', 'Extracted names are read from your file. Confirm the exact medicine and strength with your prescription — ZoikoMeds does not validate prescriptions.')}
              </p>
            </Card>
          </motion.div>
        ) : status === 'failed' ? (
          <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card className="flex flex-col items-center justify-center gap-3 rounded-2xl border-dashed border-destructive/40 bg-destructive/[0.04] px-6 py-14 text-center">
              <AlertTriangle className="size-8 text-destructive" />
              <p className="text-base font-semibold text-foreground">
                {t('couldNotReadPrescription', 'Could not read this prescription')}
              </p>
              <p className="max-w-md text-sm text-muted-foreground">{errorMessage}</p>
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="size-4" />
                {t('tryAnotherFile', 'Try another file')}
              </Button>
            </Card>
          </motion.div>
        ) : busy ? (
          <motion.div key="extracting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card className="flex flex-col items-center justify-center gap-3 rounded-2xl border-dashed border-teal/40 bg-teal/[0.04] px-6 py-16 text-center">
              <Loader2 className="size-8 animate-spin text-teal" />
              <p className="text-base font-semibold text-foreground">{statusLabel}</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {t('extractingNamesFrom', 'Extracting medicine names from')}{' '}
                <span className="font-medium">{fileName}</span>
                {progressDetail ? ` · ${progressDetail}` : ''}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t('deviceOnlyNotice', 'Reading happens on your device — the file is not uploaded.')}
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
              aria-label={t('uploadPrescriptionImage', 'Upload a prescription image')}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                dragActive ? 'border-teal bg-teal/[0.06]' : 'border-teal/40 bg-teal/[0.03] hover:border-teal/60',
              )}
            >
              <span className="flex size-14 items-center justify-center rounded-2xl bg-card text-teal shadow-soft">
                <UploadCloud className="size-6" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-lg font-bold text-foreground">{t('dropPrescriptionHere', 'Drop your prescription here')}</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {t('extractMedicineDesc', "We'll extract the medicine names — you choose which ones to search.")}
                </p>
              </div>
              <Button
                variant="outline"
                className="border-teal/40 text-teal hover:bg-teal/5"
                onClick={(e) => { e.stopPropagation(); fileInput.current?.click() }}
              >
                <UploadCloud className="size-4" />
                {t('browseFile', 'Browse file')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('maxFileNotice', 'JPG, PNG, WebP, PDF — max 10 MB')}</p>
            </div>

            {/* or — camera / gallery */}
            <div className="my-4 text-center text-sm text-muted-foreground">{t('or', 'or')}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button variant="outline" size="lg" className="h-12" onClick={() => cameraInput.current?.click()}>
                <Camera className="size-4" />
                {t('takePhoto', 'Take a photo')}
              </Button>
              <Button variant="outline" size="lg" className="h-12" onClick={() => galleryInput.current?.click()}>
                <ImageIcon className="size-4" />
                {t('fromGallery', 'From gallery')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden inputs. accept="image/jpeg,image/png" makes iOS transcode HEIC
          captures to JPEG rather than handing us an undecodable file. */}
      <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <input ref={cameraInput} type="file" accept="image/jpeg,image/png" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleFiles(e.target.files)} />

      {/* Privacy notice */}
      <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/[0.08] p-3.5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-warning" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t(
            'prescriptionPrivacyNotice',
            'Privacy notice: Your prescription is read on your device. The image is not uploaded unless you choose assisted reading. To look each medicine up, only the extracted medicine name is sent to the ZoikoMeds catalog — never the image, and never anything that identifies you. ZoikoMeds does not process, validate, or fulfil prescriptions, and provides no medical advice.',
          )}
        </p>
      </div>

      {/* Location + distance */}
      <div className="flex flex-col gap-2">
        <label htmlFor="scan-location" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {t('yourLocationForNearbySearch', 'Your location (for nearby search)')}
        </label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="scan-location"
            value={location}
            onChange={(e) => persistLocation(e.target.value)}
            placeholder={t('searchAreaPlaceholder', 'City, ZIP code, or postcode')}
            className="h-11 rounded-xl ps-10"
          />
        </div>
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className="flex w-fit items-center gap-1.5 text-sm font-semibold text-teal transition-colors hover:text-teal/80 disabled:opacity-60"
        >
          {locating ? <Loader2 className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
          {t('useMyCurrentLocation', 'Use my current location')}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">{t('distanceFromMe', 'Distance from me:')}</span>
        <select
          value={distance}
          onChange={(e) => setDistance(Number(e.target.value))}
          aria-label={t('distanceFromMe', 'Distance from me')}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {DISTANCES_KM.map((d) => (
            <option key={d} value={d}>{d} {t('km', 'km')}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
