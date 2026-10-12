import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UploadCloud, Camera, Image as ImageIcon, ShieldCheck, MapPin, LocateFixed,
  Loader2, Pill, ArrowRight, RotateCcw, FileText, CheckCircle2, AlertTriangle,
  HelpCircle,
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

// Reading happens on the server now: the file is posted to ZoikoMeds, read by a
// document model and verified against MediBase before it comes back. The
// on-device pipeline (Tesseract + pdf.js) is no longer on this path — see
// prescription-reader.js.
import { readPrescription, PrescriptionReadError, confirmMedicine } from './prescription-reader'
import { MedicineConfirmation } from './medicine-confirmation'
import { useLanguage } from '@/providers/language-provider'

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
  // Rows the patient has settled, keyed by the row's own handle rather than by
  // its name: a line whose handwriting could not be read has no name to key on.
  const [resolved, setResolved] = useState(() => new Map())
  // The one row whose confirmation controls are open, if any. Only one at a
  // time: fourteen simultaneous search forms is a page nobody can read.
  const [expandedKey, setExpandedKey] = useState(null)
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

  // Publish the detected list upward so it stays selectable from the search
  // view — the user should never have to re-scan to reach the next medicine.
  useEffect(() => {
    const usable = (result?.medicines ?? [])
      .map((medicine) => resolved.get(medicine.key) ?? medicine)
      // Gate: only a medicine with a MediBase identity behind it goes further.
      // An ambiguous or unread line has nothing to look up availability for.
      .filter((medicine) => !medicine.needsConfirmation)
    onDetected?.(usable)
  }, [result, resolved, onDetected])


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
    setResolved(new Map())
    setExpandedKey(null)
    setStatus('preparing')

    try {
      const extraction = await readPrescription(file, {
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
      // Deliberately not console.error'd with the error object: a failure here
      // can carry the request, and the request is a prescription.
      setErrorMessage(
        err instanceof PrescriptionReadError
          ? err.message
          : 'Something went wrong while reading your prescription.',
      )
      setStatus('failed')
    } finally {
      setProgress(null)
    }
  }

  // The assisted-reading handler stood here. It rendered the page to images and
  // posted them to /scan/vision-extract, which is the one path by which a
  // prescription left this browser. Reading is entirely on-device for this
  // phase, so the call site is gone and the page cannot leave.
  //
  // Deliberately the call site rather than the service: vision-fallback.js and
  // the backend route are untouched and still tested, so the model layer can be
  // reattached here — behind explicit consent — without rebuilding any of it.

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
    setResolved(new Map())
    setExpandedKey(null)
    lastFile.current = null
  }

  /**
   * Adopt the catalog medicine the patient chose for one row.
   *
   * Local: the identity already came from MediBase, as a candidate or as a
   * catalog search hit, so confirming promotes it rather than re-verifying it.
   * The prescription is not read again and no medicine record is created.
   */
  const resolveMedicine = (key, chosen) => {
    setResolved((current) => {
      const base = current.get(key) ?? (result?.medicines ?? []).find((m) => m.key === key)
      if (!base) return current
      const next = new Map(current)
      next.set(key, confirmMedicine(base, chosen))
      return next
    })
    setExpandedKey(null)
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

  /**
   * One medicine row.
   *
   * Two shapes rather than two lists: a row with a MediBase identity offers
   * Search, and a row without one offers the confirmation panel instead. The
   * Search button is deliberately absent until an identity exists — there is
   * nothing to look up availability for, and offering it would imply the
   * reading had been verified.
   */
  /**
   * One medicine row.
   *
   * Compact by default. A row that still needs a decision shows what was read,
   * one line saying why it is not settled, and a Confirm button — the catalog
   * choices and the search box only appear in the row the patient opened.
   *
   * Confirm does not confirm anything by itself. There is nothing safe for it
   * to confirm: the medicine either has several possible catalog identities or
   * none, so the button opens the controls that let the patient pick one. The
   * row becomes verified when a MediBase identity is chosen, never before.
   */
  const renderMedicine = (medicine) => {
    const current = resolved.get(medicine.key) ?? medicine
    const needsConfirm = current.needsConfirmation
    const isOpen = needsConfirm && expandedKey === medicine.key

    return (
      <motion.li
        key={medicine.key}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        className={cn(
          'flex flex-col rounded-xl border bg-card p-3 transition-colors',
          needsConfirm ? 'border-warning/40' : 'border-border hover:border-primary/30',
        )}
      >
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg',
                needsConfirm ? 'bg-warning/10 text-warning' : 'bg-teal/10 text-teal',
              )}
            >
              {needsConfirm ? <HelpCircle className="size-4" /> : <Pill className="size-4" />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">{current.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {current.detail || t('prescriptionMedicine', 'Prescription medicine')}
              </span>
              {needsConfirm && current.note && (
                // Wraps rather than truncates: on a 360px screen the text
                // column is narrow enough that "Read from your prescri…" is the
                // whole message gone, and this line is the reason the row is
                // asking for anything.
                <span className="text-[11px] leading-snug text-warning">
                  {t(current.note.key, current.note.text)}
                </span>
              )}
              {current.confirmedByUser && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {t('readFromPrescription', 'Read from your prescription as')}{' '}
                  <span className="font-medium">{current.sourceText}</span>
                </span>
              )}
            </span>
          </span>

          {needsConfirm ? (
            <Button
              size="sm"
              variant={isOpen ? 'ghost' : 'outline'}
              className="shrink-0"
              aria-expanded={isOpen}
              onClick={() => setExpandedKey(isOpen ? null : medicine.key)}
            >
              {isOpen ? t('cancel', 'Cancel') : t('confirm', 'Confirm')}
            </Button>
          ) : (
            <Button size="sm" className="shrink-0" onClick={() => onSearchMedicine?.(current)}>
              {t('search', 'Search')}
              <ArrowRight className="size-3.5" />
            </Button>
          )}
        </span>

        {isOpen && (
          <MedicineConfirmation
            medicine={current}
            onConfirm={(chosen) => resolveMedicine(medicine.key, chosen)}
            t={t}
          />
        )}
      </motion.li>
    )
  }

  // Lists are derived from the merged state, so a row moves from "please
  // confirm" to "ready to search" the moment the patient settles it.
  const mergedMedicines = (result?.medicines ?? []).map(
    (medicine) => resolved.get(medicine.key) ?? medicine,
  )
  const readyMedicines = mergedMedicines.filter((medicine) => !medicine.needsConfirmation)
  const unconfirmedMedicines = mergedMedicines.filter((medicine) => medicine.needsConfirmation)

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

              {readyMedicines.length > 0 && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t('chooseMedicinesToSearch', 'Choose which medicines to search for availability near you.')}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {readyMedicines.map(renderMedicine)}
                  </ul>
                </>
              )}

              {unconfirmedMedicines.length > 0 && (
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
                    {unconfirmedMedicines.map(renderMedicine)}
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

              {/*
                Poor scan, handled locally.

                This block used to offer assisted reading, which uploads the
                page to the server for a model to read. That path still exists
                end to end and is switched off here for this phase: reading is
                entirely on-device, so the prescription does not leave the
                browser at all, and there is no provider to consent to. The
                button is what reached it, so removing the button is what
                prevents it — the service and its route are untouched and will
                be reached again deliberately, with consent, when the model
                layer lands.

                What replaces it is advice the patient can act on. An empty
                result with no explanation reads as a broken feature; the
                reasons the quality assessment already computed are what these
                suggestions are for.
              */}
              {result.needsVisionFallback && !result.visionUsed && (
                <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/[0.04] p-3.5">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <AlertTriangle className="size-4 text-warning" />
                    {t('couldNotReadClearly', "We couldn't read this prescription clearly.")}
                  </span>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t(
                      'poorScanGuidance',
                      'Some of the page could not be read with confidence, so a medicine may be missing or misread. Check the list below against the prescription, and try again with a clearer copy.',
                    )}
                  </p>
                  <ul className="flex list-disc flex-col gap-0.5 ps-4 text-xs text-muted-foreground">
                    <li>{t('poorScanTipLighting', 'Retake the photo in good, even lighting.')}</li>
                    <li>{t('poorScanTipFlat', 'Keep the prescription flat and square to the camera.')}</li>
                    <li>{t('poorScanTipBlur', 'Hold steady so the text is sharp, not blurred.')}</li>
                    <li>{t('poorScanTipWhole', 'Include the whole prescription in the frame.')}</li>
                    <li>{t('poorScanTipPdf', 'If you have the original PDF, upload that instead of a photo.')}</li>
                  </ul>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => fileInput.current?.click()}
                  >
                    <UploadCloud className="size-3.5" />
                    {t('uploadClearerCopy', 'Upload a clearer image or PDF')}
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
                {t(
                  'secureReadingNotice',
                  'Your file is securely sent for document processing. ZoikoMeds does not keep it afterwards.',
                )}
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
            'Privacy notice: Your prescription is securely sent for document processing. ZoikoMeds does not retain the uploaded file after processing. Extracted medicines are checked against MediBase before they are shown as verified. ZoikoMeds does not process, validate, or fulfil prescriptions. No medical advice is provided.',
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
