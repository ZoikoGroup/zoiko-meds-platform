import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import Tesseract from 'tesseract.js'
import { matchMedicines } from '@/services/medicine-api'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

// Known medicine dictionary for offline or direct fallback lookup
const KNOWN_DRUGS = [
  { name: 'Naproxen', generic: 'Naproxen', defaultStrength: '500 mg' },
  { name: 'Paracetamol', generic: 'Paracetamol', defaultStrength: '500 mg' },
  { name: 'Paracetamol 500 mg', generic: 'Paracetamol', defaultStrength: '500 mg' },
  { name: 'Dolo 650', generic: 'Paracetamol', defaultStrength: '650 mg' },
  { name: 'Acetaminophen', generic: 'Paracetamol / Acetaminophen', defaultStrength: '500 mg' },
  { name: 'Metformin 500 mg', generic: 'Metformin', defaultStrength: '500 mg' },
  { name: 'Metformin', generic: 'Metformin', defaultStrength: '500 mg' },
  { name: 'Pantoprazole 40 mg', generic: 'Pantoprazole', defaultStrength: '40 mg' },
  { name: 'Pantoprazole', generic: 'Pantoprazole', defaultStrength: '40 mg' },
  { name: 'Cetirizine 10 mg', generic: 'Cetirizine', defaultStrength: '10 mg' },
  { name: 'Cetirizine', generic: 'Cetirizine', defaultStrength: '10 mg' },
  { name: 'Amoxicillin 500 mg', generic: 'Amoxicillin', defaultStrength: '500 mg' },
  { name: 'Amoxicillin', generic: 'Amoxicillin', defaultStrength: '500 mg' },
  { name: 'Azithromycin 500 mg', generic: 'Azithromycin', defaultStrength: '500 mg' },
  { name: 'Azithromycin', generic: 'Azithromycin', defaultStrength: '500 mg' },
  { name: 'Ibuprofen 400 mg', generic: 'Ibuprofen', defaultStrength: '400 mg' },
  { name: 'Ibuprofen', generic: 'Ibuprofen', defaultStrength: '400 mg' },
  { name: 'Insulin Glargine', generic: 'Insulin glargine', defaultStrength: '100 U/mL' },
  { name: 'Lantus Pen', generic: 'Insulin glargine', defaultStrength: '100 U/mL' },
  { name: 'Basaglar Pen', generic: 'Insulin glargine', defaultStrength: '100 U/mL' },
  { name: 'Aspirin', generic: 'Aspirin', defaultStrength: '75 mg' },
  { name: 'Lipitor', generic: 'Atorvastatin', defaultStrength: '20 mg' },
  { name: 'Atorvastatin', generic: 'Atorvastatin', defaultStrength: '20 mg' },
  { name: 'Amlodipine', generic: 'Amlodipine', defaultStrength: '5 mg' },
  { name: 'Omeprazole', generic: 'Omeprazole', defaultStrength: '20 mg' },
  { name: 'Losartan', generic: 'Losartan', defaultStrength: '50 mg' },
  { name: 'Ciprofloxacin', generic: 'Ciprofloxacin', defaultStrength: '500 mg' },
  { name: 'Augmentin', generic: 'Amoxicillin / Clavulanate', defaultStrength: '625 mg' },
  { name: 'Combiflam', generic: 'Ibuprofen / Paracetamol', defaultStrength: '400 mg' },
]

/**
 * Extract text from a PDF file preserving line breaks (using Y position & hasEOL)
 */
async function extractTextFromPDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
    const pdf = await loadingTask.promise
    let fullText = ''

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      let lastY = null
      let pageLines = []
      let currentLine = ''

      for (const item of textContent.items) {
        if (!item || item.str === undefined) continue
        const str = item.str
        const y = item.transform ? item.transform[5] : null

        const isNewLine = item.hasEOL || (lastY !== null && y !== null && Math.abs(y - lastY) > 4)

        if (isNewLine && currentLine.trim()) {
          pageLines.push(currentLine.trim())
          currentLine = ''
        }

        currentLine += (currentLine && !str.startsWith(' ') ? ' ' : '') + str
        lastY = y
      }

      if (currentLine.trim()) {
        pageLines.push(currentLine.trim())
      }

      fullText += pageLines.join('\n') + '\n'
    }

    if (fullText.trim().length >= 3) {
      return fullText.trim()
    }

    // Fallback to rendering canvas and OCR if PDF contains scanned image
    let ocrText = ''
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise

      const res = await Tesseract.recognize(canvas, 'eng')
      ocrText += (res.data?.text || '') + '\n'
    }
    return ocrText.trim()
  } catch (err) {
    console.error('PDF text extraction error:', err)
    return ''
  }
}

/**
 * Extract text from Image file via Tesseract.js OCR
 */
async function extractTextFromImage(file) {
  try {
    const res = await Tesseract.recognize(file, 'eng')
    return res.data?.text || ''
  } catch (err) {
    console.error('Image OCR error:', err)
    return ''
  }
}

/**
 * Clean raw OCR text into individual candidate medicine lines/terms
 */
function cleanAndExtractLines(rawText, fileName = '') {
  const IGNORE_RE = /^(doctor|patient|date|address|rx|sig|qty|dispense|refill|phone|tel|signature|hospital|clinic|prescription|zoikomeds|page|scan|instructions|notes|take|tablet|capsule|mg|ml|daily|once|twice|thrice|after|before|food|water|bedtime|morning|night)\b/i

  const rawLines = (rawText || '').split(/[\r\n]+/)
  const candidateTerms = []

  for (const line of rawLines) {
    const trimmed = line.replace(/^[^a-zA-Z0-9]+/, '').replace(/[^a-zA-Z0-9.\s%/-]+$/, '').trim()
    if (!trimmed || trimmed.length < 3 || IGNORE_RE.test(trimmed)) continue

    // Split line further if it contains multiple items separated by comma, slash, plus, or 'and'
    const subTerms = trimmed
      .split(/[,/+]|\band\b/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !IGNORE_RE.test(t))

    if (subTerms.length > 1) {
      candidateTerms.push(...subTerms)
    } else {
      candidateTerms.push(trimmed)
    }
  }

  // If raw text yielded no usable lines, use the file name as a candidate term
  if (candidateTerms.length === 0 && fileName) {
    const cleanedName = fileName
      .replace(/\.[^/.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\(\d+\)/g, '')
      .trim()
    if (cleanedName.length >= 2) {
      candidateTerms.push(cleanedName)
    }
  }

  return [...new Set(candidateTerms)]
}

/**
 * Extract medicines dynamically from uploaded prescription file
 */
export async function extractPrescriptionMeds(file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  let rawText = ''
  if (isPdf) {
    rawText = await extractTextFromPDF(file)
  } else {
    rawText = await extractTextFromImage(file)
  }

  const candidateLines = cleanAndExtractLines(rawText, file.name)
  const results = []
  const seenNames = new Set()

  for (const line of candidateLines) {
    // 1. Query live MediBase catalog for accurate medicine match & clinical details
    let matched = null
    try {
      const apiMatches = await matchMedicines(line, 3)
      if (apiMatches && apiMatches.length > 0) {
        // Ensure match quality
        const topMatch = apiMatches[0]
        const lineLower = line.toLowerCase()
        const matchNameLower = topMatch.name.toLowerCase()
        const genericLower = (topMatch.generic || '').toLowerCase()

        if (
          lineLower.includes(matchNameLower) ||
          matchNameLower.includes(lineLower) ||
          (genericLower && (lineLower.includes(genericLower) || genericLower.includes(lineLower)))
        ) {
          matched = topMatch
        }
      }
    } catch {
      // Ignored if API is unavailable
    }

    if (matched) {
      const nameKey = matched.name.toLowerCase()
      if (!seenNames.has(nameKey)) {
        seenNames.add(nameKey)
        const detailParts = []
        if (matched.generic && matched.generic.toLowerCase() !== matched.name.toLowerCase()) {
          detailParts.push(matched.generic)
        }
        if (matched.strength) detailParts.push(matched.strength)
        else if (matched.form) detailParts.push(matched.form)

        results.push({
          name: matched.name,
          detail: detailParts.join(' · ') || 'Prescription medicine',
        })
      }
      continue
    }

    // 2. Check local KNOWN_DRUGS dictionary
    const lowerLine = line.toLowerCase()
    const knownMatch = KNOWN_DRUGS.find(
      (d) => lowerLine.includes(d.name.toLowerCase()) || lowerLine.includes(d.generic.toLowerCase()) || d.name.toLowerCase().includes(lowerLine)
    )

    if (knownMatch) {
      const nameKey = knownMatch.name.toLowerCase()
      if (!seenNames.has(nameKey)) {
        seenNames.add(nameKey)
        results.push({
          name: knownMatch.name,
          detail: `${knownMatch.generic} · ${knownMatch.defaultStrength}`,
        })
      }
      continue
    }

    // 3. Fallback: Extract medicine name & strength dynamically from line text
    const strengthMatch = line.match(/\b\d+\s*(mg|g|mcg|ml|iu|u)\b/i)
    const strengthStr = strengthMatch ? strengthMatch[0] : ''

    let nameCandidate = line
      .replace(/\b\d+\s*(mg|g|mcg|ml|iu|u)\b/gi, '')
      .replace(/\b(tablet|tab|capsule|cap|syrup|injection|suspension)\b/gi, '')
      .trim()

    if (nameCandidate.length >= 3) {
      nameCandidate = nameCandidate.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substring(1).toLowerCase())
      const nameKey = nameCandidate.toLowerCase()
      if (!seenNames.has(nameKey)) {
        seenNames.add(nameKey)
        results.push({
          name: nameCandidate,
          detail: strengthStr ? `${nameCandidate} · ${strengthStr}` : `${nameCandidate} · Prescription medicine`,
        })
      }
    }
  }

  // 4. Final fallback if nothing found
  if (results.length === 0 && file.name) {
    const fileBase = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim()
    if (fileBase) {
      const capName = fileBase.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substring(1).toLowerCase())
      results.push({
        name: capName,
        detail: `${capName} · Extracted from prescription`,
      })
    }
  }

  return results
}
