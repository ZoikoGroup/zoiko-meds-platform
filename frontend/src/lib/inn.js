/**
 * Local-language medicine names → INN (International Nonproprietary Name).
 *
 * The backend already resolves Latin-script naming differences: MediBase's
 * expandVariants() knows paracetamol↔acetaminophen, salbutamol↔albuterol and
 * the rest, and MedicineEntity carries brandNames. What it cannot do is read a
 * query typed in Arabic or Chinese, because the catalog is stored in Latin
 * script. This maps such a query onto its INN *before* it is sent, so the
 * existing search does the rest unchanged.
 *
 * Scope and safety:
 *  - This is a NAME index, not clinical data. It never changes what a medicine
 *    is, never substitutes one medicine for another, and never touches
 *    inventory, availability or pharmacy ranking.
 *  - Every entry is the same active ingredient expressed in another language or
 *    another accepted romanisation — never a therapeutic equivalent.
 *  - A query with no entry is passed through untouched, so behaviour for every
 *    existing Latin-script search is byte-identical.
 *
 * Data lives here rather than in the locale files on purpose: UI copy is
 * translated per language, whereas a medicine name resolves to one INN
 * regardless of the interface language a patient happens to be using.
 */

/**
 * INN → the names patients type for it, across the Phase 1 languages.
 * Latin-script synonyms the backend already knows are deliberately omitted;
 * duplicating them here would create two places to keep in step.
 */
const INN_SYNONYMS = {
  paracetamol: [
    'paracétamol', 'paracetamolo', 'parasetamol',
    'باراسيتامول', 'بارستمول', 'اسيتامينوفين',
    '对乙酰氨基酚', '扑热息痛', '醋氨酚',
  ],
  ibuprofen: ['ibuprofène', 'ibuprofeno', 'إيبوبروفين', 'ايبوبروفين', '布洛芬'],
  amoxicillin: ['amoxicilline', 'amoxicilina', 'أموكسيسيلين', 'اموكسيسيلين', '阿莫西林'],
  azithromycin: ['azithromycine', 'azitromicina', 'أزيثرومايسين', '阿奇霉素'],
  metformin: ['metformine', 'metformina', 'ميتفورمين', '二甲双胍'],
  omeprazole: ['oméprazole', 'omeprazol', 'أوميبرازول', '奥美拉唑'],
  pantoprazole: ['pantoprazol', 'بانتوبرازول', '泮托拉唑'],
  atorvastatin: ['atorvastatine', 'atorvastatina', 'أتورفاستاتين', '阿托伐他汀'],
  amlodipine: ['amlodipina', 'أملوديبين', '氨氯地平'],
  salbutamol: ['سالبوتامول', '沙丁胺醇'],
  cetirizine: ['cétirizine', 'cetirizina', 'سيتيريزين', '西替利嗪'],
  levocetirizine: ['lévocétirizine', 'levocetirizina', 'ليفوسيتيريزين', '左西替利嗪'],
  montelukast: ['montélukast', 'monteluca', 'مونتيلوكاست', '孟鲁司特'],
  diclofenac: ['diclofénac', 'diclofenaco', 'ديكلوفيناك', '双氯芬酸'],
  aspirin: ['aspirine', 'aspirina', 'acide acétylsalicylique', 'أسبرين', 'اسبرين', '阿司匹林'],
  cefixime: ['céfixime', 'cefixima', 'سيفيكسيم', '头孢克肟'],
  ciprofloxacin: ['ciprofloxacine', 'ciprofloxacino', 'سيبروفلوكساسين', '环丙沙星'],
  doxycycline: ['doxiciclina', 'دوكسيسيكلين', '多西环素'],
  metronidazole: ['métronidazole', 'metronidazol', 'ميترونيدازول', '甲硝唑'],
  prednisolone: ['prednisolona', 'بريدنيزولون', '泼尼松龙'],
  insulin: ['insuline', 'insulina', 'إنسولين', 'انسولين', '胰岛素'],
  'insulin glargine': ['insuline glargine', 'insulina glargina', 'إنسولين جلارجين', '甘精胰岛素'],
  levothyroxine: ['lévothyroxine', 'levotiroxina', 'ليفوثيروكسين', '左甲状腺素'],
  losartan: ['لوسارتان', '氯沙坦'],
  telmisartan: ['تيلميسارتان', '替米沙坦'],
  ranitidine: ['رانيتيدين', '雷尼替丁'],
  domperidone: ['dompéridone', 'domperidona', 'دومبيريدون', '多潘立酮'],
  ondansetron: ['ondansétron', 'ondansetrón', 'أوندانسيترون', '昂丹司琼'],
  albendazole: ['ألبندازول', 'ألبيندازول', '阿苯达唑'],
  ivermectin: ['ivermectine', 'ivermectina', 'إيفرمكتين', '伊维菌素'],
  'povidone iodine': ['povidone iodée', 'povidona yodada', 'بوفيدون اليود', '聚维酮碘'],
  chlorpheniramine: ['chlorphénamine', 'clorfenamina', 'كلورفينيرامين', '氯苯那敏'],
  phenylephrine: ['phényléphrine', 'fenilefrina', 'فينيليفرين', '去氧肾上腺素'],
}

/**
 * Normalize for lookup: case-folded, accent-stripped, punctuation-free.
 *
 * Accents are folded so "paracétamol" and "paracetamol" are one key; Arabic and
 * CJK characters are untouched by NFD folding and survive intact.
 */
export function normalizeQuery(text) {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Reverse index: normalized local name → INN. Built once. */
const INN_INDEX = (() => {
  const index = new Map()
  for (const [inn, names] of Object.entries(INN_SYNONYMS)) {
    index.set(normalizeQuery(inn), inn)
    for (const name of names) index.set(normalizeQuery(name), inn)
  }
  return index
})()

/**
 * The INN a query names, or null when it names none.
 *
 * Whole-string first, then a single token, so "باراسيتامول ٥٠٠" still resolves
 * while a phrase that merely contains a drug word does not get rewritten out
 * from under the patient.
 */
export function innFor(query) {
  const normalized = normalizeQuery(query)
  if (!normalized) return null

  const direct = INN_INDEX.get(normalized)
  if (direct) return direct

  for (const token of normalized.split(' ')) {
    const hit = INN_INDEX.get(token)
    if (hit) return hit
  }
  return null
}

/**
 * A letter that is not Latin script -- i.e. Arabic or CJK input.
 *
 * Reads as "neither a non-letter nor a Latin letter". Digits, punctuation
 * and spaces are ignored, so "Dolo 650" and "Betadine 10%" stay Latin.
 */
const NON_LATIN_LETTER = /[^\P{L}\p{Script=Latin}]/u

/**
 * The query to send to the search API.
 *
 * Returns the INN when the query was typed in another language, and the
 * original string otherwise — so every Latin-script search behaves exactly as
 * it did before this layer existed.
 */
export function toSearchQuery(query) {
  const q = (query ?? '').trim()
  if (!q) return q
  // Already Latin script: MediBase's own variant expansion and brand-name
  // matching handle it, and they see more of the catalog than this index does.
  if (!NON_LATIN_LETTER.test(q)) return q
  return innFor(q) ?? q
}

/** Exposed for tests and for anything that needs the raw index. */
export const INN_NAMES = INN_SYNONYMS
