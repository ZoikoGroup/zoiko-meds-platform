import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import Tesseract from 'tesseract.js'
import { matchMedicines } from '@/services/medicine-api'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

// Known medicine dictionary for offline, direct fallback, and fuzzy handwriting matching
const KNOWN_DRUGS = [
  {
    name: 'Calpol',
    generic: 'Paracetamol',
    defaultStrength: '250mg/5ml Syrup',
    aliases: ['calpol', 'colpol', 'calpl', 'syp calpol', 'calpol 250', 'calpol 500', 'calpol 650', 'calpol syrup'],
  },
  {
    name: 'Delcon',
    generic: 'Phenylephrine / Chlorpheniramine',
    defaultStrength: 'Syrup',
    aliases: ['delcon', 'oblon', 'deicon', 'delco', 'syp delcon', 'delcon syrup', 'delcon tds'],
  },
  {
    name: 'Levolin',
    generic: 'Levosalbutamol',
    defaultStrength: 'Syrup',
    aliases: ['levolin', 'levoun', 'levoln', 'levo', 'syp levolin', 'levolin syrup', 'levolin tds'],
  },
  {
    name: 'Meftal-P',
    generic: 'Mefenamic Acid / Paracetamol',
    defaultStrength: '100mg/5ml Suspension',
    aliases: ['meftal-p', 'meftal p', 'meftal', 'meltal', 'syp meftal-p', 'meftal-p 100/5', 'meftal-p syp', 'meftal p syp'],
  },
  {
    name: 'Dolo 650',
    generic: 'Paracetamol',
    defaultStrength: '650 mg',
    aliases: ['dolo', 'dolo 650', 'dolo650'],
  },
  {
    name: 'Crocin',
    generic: 'Paracetamol',
    defaultStrength: '500 mg',
    aliases: ['crocin', 'crocin 500', 'crocin advance', 'crocin 650'],
  },
  {
    name: 'Augmentin 625',
    generic: 'Amoxicillin / Clavulanate',
    defaultStrength: '625 mg',
    aliases: ['augmentin', 'augmentin 625', 'augmentin duo'],
  },
  {
    name: 'Clavam 625',
    generic: 'Amoxicillin / Clavulanate',
    defaultStrength: '625 mg',
    aliases: ['clavam', 'clavam 625'],
  },
  {
    name: 'Combiflam',
    generic: 'Ibuprofen / Paracetamol',
    defaultStrength: '400 mg / 325 mg',
    aliases: ['combiflam', 'combiflam tab'],
  },
  {
    name: 'Azithromycin',
    generic: 'Azithromycin',
    defaultStrength: '500 mg',
    aliases: ['azithromycin', 'azithral', 'aziwok', 'azithral 500'],
  },
  {
    name: 'Pantoprazole',
    generic: 'Pantoprazole',
    defaultStrength: '40 mg',
    aliases: ['pantoprazole', 'panto', 'pantocid', 'pantodac', 'pan 40'],
  },
  {
    name: 'Pan-D',
    generic: 'Pantoprazole / Domperidone',
    defaultStrength: '40 mg / 30 mg',
    aliases: ['pan-d', 'pan d', 'pantocid-d'],
  },
  {
    name: 'Cetirizine',
    generic: 'Cetirizine',
    defaultStrength: '10 mg',
    aliases: ['cetirizine', 'cetzine', 'okacet', 'alerid'],
  },
  {
    name: 'Montair-LC',
    generic: 'Montelukast / Levocetirizine',
    defaultStrength: '10 mg / 5 mg',
    aliases: ['montair-lc', 'montair lc', 'montair', 'montek-lc'],
  },
  {
    name: 'Asthalin',
    generic: 'Salbutamol',
    defaultStrength: 'Syrup / Inhaler',
    aliases: ['asthalin', 'asthalin syp', 'asthalin inhaler'],
  },
  {
    name: 'Ascoril',
    generic: 'Terbutaline / Bromhexine / Guaiphenesin',
    defaultStrength: 'Syrup',
    aliases: ['ascoril', 'ascoril-d', 'ascoril ls'],
  },
  {
    name: 'Alex Syrup',
    generic: 'Dextromethorphan / Chlorpheniramine / Phenylephrine',
    defaultStrength: 'Syrup',
    aliases: ['alex', 'alex syrup', 'alex syp'],
  },
  {
    name: 'Cheston Cold',
    generic: 'Paracetamol / Phenylephrine / Cetirizine',
    defaultStrength: 'Syrup / Tablet',
    aliases: ['cheston cold', 'cheston', 'cheston cold syp'],
  },
  {
    name: 'Zerodol-SP',
    generic: 'Aceclofenac / Paracetamol / Serratiopeptidase',
    defaultStrength: '100 mg / 325 mg / 15 mg',
    aliases: ['zerodol-sp', 'zerodol sp', 'zerodol-p', 'zerodol'],
  },
  {
    name: 'Taxim-O',
    generic: 'Cefixime',
    defaultStrength: '200 mg',
    aliases: ['taxim-o', 'taxim o', 'cefixime'],
  },
  {
    name: 'Sumo',
    generic: 'Nimesulide / Paracetamol',
    defaultStrength: '100 mg / 325 mg',
    aliases: ['sumo', 'sumo tab', 'sumo syp'],
  },
  {
    name: 'Flexon',
    generic: 'Ibuprofen / Paracetamol',
    defaultStrength: '400 mg / 325 mg',
    aliases: ['flexon', 'flexon mr'],
  },
  {
    name: 'Sinarest',
    generic: 'Paracetamol / Chlorpheniramine / Phenylephrine',
    defaultStrength: 'Tablet / Syrup',
    aliases: ['sinarest', 'sinarest syp'],
  },
  {
    name: 'Allegra',
    generic: 'Fexofenadine',
    defaultStrength: '120 mg',
    aliases: ['allegra', 'allegra 120', 'allegra 180'],
  },
  {
    name: 'Amoxicillin',
    generic: 'Amoxicillin',
    defaultStrength: '500 mg',
    aliases: ['amoxicillin', 'mox', 'novamox', 'amoxil'],
  },
  {
    name: 'Ibuprofen',
    generic: 'Ibuprofen',
    defaultStrength: '400 mg',
    aliases: ['ibuprofen', 'brufen'],
  },
  {
    name: 'Metformin',
    generic: 'Metformin',
    defaultStrength: '500 mg',
    aliases: ['metformin', 'glycomet'],
  },
  {
    name: 'Amlodipine',
    generic: 'Amlodipine',
    defaultStrength: '5 mg',
    aliases: ['amlodipine', 'amlong', 'stamlo'],
  },
]

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  if (!a || !b) return (a || b).length
  const matrix = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

/**
 * Calculate normalized similarity ratio (0.0 to 1.0)
 */
function similarityRatio(s1, s2) {
  const str1 = (s1 || '').toLowerCase().trim()
  const str2 = (s2 || '').toLowerCase().trim()
  if (str1 === str2) return 1.0
  const dist = levenshteinDistance(str1, str2)
  const maxLen = Math.max(str1.length, str2.length)
  return maxLen === 0 ? 1.0 : (maxLen - dist) / maxLen
}

/**
 * Regex identifying non-medicine prescription content (doctor, qualification, hospital, dates, vitals, patient)
 */
const NON_MEDICINE_RE = /(doctor|dr\.?\b|mbbs|paediatrics|pediatrics|jipmer|govt|medical|college|reg\.?\s*no|ph\.?\s*:?|phone|tel\b|contact|chc\b|phc\b|hospital|clinic|thrissur|nemmara|narayanan|date|name\s*:|ashvika|weight|kg\b|lbs\b|age|gender|yr\b|yrs\b|clinical|description|urti\b|rr\s*-|rs\s*-|b\/l|aee\b|min\b|bp\b|pulse|temp|advice|advise|morning|evening|night|timings|7\.00|8\.45|3\.30|7\.30|page|\d{10}|\d{6,})/i

/**
 * Detect dosage form prefix (Syp, Tab, Cap, Inj, etc.)
 */
const FORM_PREFIX_RE = /^(syp|syrup|tab|tablet|cap|capsule|inj|injection|oint|cream|drops|soln|susp|sachet|respules|lotion|gel|soap|inhaler)\b/i

/**
 * Extract text from a PDF file preserving line breaks
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
 * Clean raw OCR text and extract ONLY candidate prescription medicine lines
 */
function cleanAndExtractLines(rawText) {
  const rawLines = (rawText || '').split(/[\r\n]+/)
  const candidateTerms = []
  let inAdviceSection = false

  for (const line of rawLines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Detect start of Advice / Rx section
    if (/\b(advice|advise|rx|r\/|treatment|medicines)\b/i.test(trimmed)) {
      inAdviceSection = true
      continue
    }

    // Reject non-Latin Malayalam/Hindi lines
    const latinChars = (trimmed.match(/[a-zA-Z]/g) || []).length
    if (latinChars < 2) continue

    // Check if line starts with dosage form prefix or is inside Advice section
    const hasFormPrefix = FORM_PREFIX_RE.test(trimmed)
    const isNonMedicine = NON_MEDICINE_RE.test(trimmed)

    if (isNonMedicine && !hasFormPrefix) {
      continue
    }

    // Line is candidate if inside Advice section OR has clear Form Prefix
    if (inAdviceSection || hasFormPrefix) {
      candidateTerms.push(trimmed)
    } else {
      // Check if line matches any drug alias directly
      const lower = trimmed.toLowerCase()
      const matchesDrug = KNOWN_DRUGS.some((d) =>
        d.aliases.some((a) => lower.includes(a) || similarityRatio(lower, a) >= 0.6)
      )
      if (matchesDrug) {
        candidateTerms.push(trimmed)
      }
    }
  }

  return [...new Set(candidateTerms)]
}

/**
 * Clean a candidate line into a normalized medicine name & dosage detail
 */
function parseMedicineLine(line) {
  let cleaned = line
    .replace(/[^\x00-\x7F]/g, '') // remove non-ASCII characters
    .replace(NON_MEDICINE_RE, '')
    .trim()

  // Extract strength pattern e.g. (250/5), (100/5), 500mg, 4ml
  const ratioMatch = cleaned.match(/\((\d+[/.]\d+)\)|\b(\d+\s*(mg|g|mcg|ml|iu|u))\b/i)
  const strengthStr = ratioMatch ? (ratioMatch[1] ? `${ratioMatch[1]} mg/ml` : ratioMatch[0]) : ''

  // Detect dosage form prefix
  const formMatch = line.match(FORM_PREFIX_RE)
  const formStr = formMatch ? formMatch[0].toUpperCase() : ''

  // Strip form prefix, strength, volume, frequency (TDS, Q6H, SOS, BD, OD), duration (x 3 d, x 5 d)
  let cleanName = cleaned
    .replace(FORM_PREFIX_RE, '')
    .replace(/\((\d+[/.]\d+)\)/g, '')
    .replace(/\b\d+\s*(mg|g|mcg|ml|iu|u)\b/gi, '')
    .replace(/\b(tds|bd|od|qid|q6h|q8h|sos|stat|hs|bbf|abf)\b/gi, '')
    .replace(/\bx\s*\d+\s*[ds]?\b/gi, '')
    .replace(/\b\d+\s*[ds]\b/gi, '')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleanName.length < 2) return null

  return {
    rawName: cleanName,
    form: formStr,
    strength: strengthStr,
  }
}

/**
 * Perform fuzzy matching against KNOWN_DRUGS and handwriting aliases
 */
function fuzzyMatchKnownDrugs(candidateName) {
  const lowerCand = candidateName.toLowerCase().trim()
  if (!lowerCand || lowerCand.length < 2) return null

  let bestMatch = null
  let highestScore = 0

  for (const drug of KNOWN_DRUGS) {
    for (const alias of drug.aliases) {
      if (lowerCand === alias || lowerCand.includes(alias) || alias.includes(lowerCand)) {
        return drug
      }
      const score = similarityRatio(lowerCand, alias)
      if (score > highestScore && score >= 0.55) {
        highestScore = score
        bestMatch = drug
      }
    }
  }

  return highestScore >= 0.55 ? bestMatch : null
}

/**
 * Main export: Extract medicines dynamically from uploaded prescription file
 */
export async function extractPrescriptionMeds(file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  let rawText = ''
  if (isPdf) {
    rawText = await extractTextFromPDF(file)
  } else {
    rawText = await extractTextFromImage(file)
  }

  const candidateLines = cleanAndExtractLines(rawText)
  const results = []
  const seenNames = new Set()

  for (const line of candidateLines) {
    const parsed = parseMedicineLine(line)
    if (!parsed || !parsed.rawName) continue

    // 1. Check local KNOWN_DRUGS fuzzy handwriting matching first
    const drugMatch = fuzzyMatchKnownDrugs(parsed.rawName)
    if (drugMatch) {
      const nameKey = drugMatch.name.toLowerCase()
      if (!seenNames.has(nameKey)) {
        seenNames.add(nameKey)
        const detailParts = []
        if (drugMatch.generic) detailParts.push(drugMatch.generic)
        if (parsed.strength) detailParts.push(parsed.strength)
        else if (drugMatch.defaultStrength) detailParts.push(drugMatch.defaultStrength)

        results.push({
          name: drugMatch.name,
          detail: detailParts.join(' · ') || 'Prescription medicine',
        })
      }
      continue
    }

    // 2. Query live MediBase catalog for accurate medicine match
    let matched = null
    try {
      const apiMatches = await matchMedicines(parsed.rawName, 3)
      if (apiMatches && apiMatches.length > 0) {
        const topMatch = apiMatches[0]
        const lineLower = parsed.rawName.toLowerCase()
        const matchNameLower = topMatch.name.toLowerCase()
        const genericLower = (topMatch.generic || '').toLowerCase()

        if (
          lineLower.includes(matchNameLower) ||
          matchNameLower.includes(lineLower) ||
          (genericLower && (lineLower.includes(genericLower) || genericLower.includes(lineLower))) ||
          similarityRatio(lineLower, matchNameLower) >= 0.6
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
        if (parsed.strength) detailParts.push(parsed.strength)
        else if (matched.strength) detailParts.push(matched.strength)

        results.push({
          name: matched.name,
          detail: detailParts.join(' · ') || 'Prescription medicine',
        })
      }
      continue
    }

    // 3. Fallback: Accept candidate ONLY IF it had an explicit dosage form prefix (Syp, Tab, Cap, Inj, etc.)
    if (parsed.form && parsed.rawName.length >= 3 && !NON_MEDICINE_RE.test(parsed.rawName)) {
      const capName = parsed.rawName.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substring(1).toLowerCase())
      const nameKey = capName.toLowerCase()
      if (!seenNames.has(nameKey)) {
        seenNames.add(nameKey)
        results.push({
          name: capName,
          detail: parsed.strength ? `${capName} · ${parsed.strength}` : `${capName} · Prescription ${parsed.form || 'medicine'}`,
        })
      }
    }
  }

  // Final safety fallback: If raw text produced zero valid medicines, check if file name is a drug candidate
  if (results.length === 0 && file.name) {
    const fileBase = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim()
    const drugMatch = fuzzyMatchKnownDrugs(fileBase)
    if (drugMatch) {
      results.push({
        name: drugMatch.name,
        detail: `${drugMatch.generic} · ${drugMatch.defaultStrength}`,
      })
    }
  }

  return results
}

