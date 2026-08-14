// Offline medicine dictionary — LAST RESORT ONLY.
//
// This list used to be the first matcher in the scan pipeline, which meant a
// 29-entry hardcoded array outranked the governed MediBase catalog. It is now
// consulted only when the MediBase API is unreachable (offline, backend down),
// and anything it matches is scored below a catalog match and flagged for user
// confirmation. See MATCH_SOURCE.OFFLINE_DICTIONARY in confidence.js.
//
// Do not grow this list to "add support" for a medicine — add it to MediBase.

import { bestSimilarity, containsName } from './text-normalize'

export const KNOWN_DRUGS = [
  { name: 'Calpol', generic: 'Paracetamol', defaultStrength: '250mg/5ml Syrup', aliases: ['calpol', 'syp calpol', 'calpol syrup'] },
  { name: 'Delcon', generic: 'Phenylephrine / Chlorpheniramine', defaultStrength: 'Syrup', aliases: ['delcon', 'syp delcon', 'delcon syrup'] },
  { name: 'Levolin', generic: 'Levosalbutamol', defaultStrength: 'Syrup', aliases: ['levolin', 'syp levolin', 'levolin syrup'] },
  { name: 'Meftal-P', generic: 'Mefenamic Acid / Paracetamol', defaultStrength: '100mg/5ml Suspension', aliases: ['meftal-p', 'meftal p', 'meftal'] },
  { name: 'Dolo 650', generic: 'Paracetamol', defaultStrength: '650 mg', aliases: ['dolo', 'dolo 650', 'dolo650'] },
  { name: 'Crocin', generic: 'Paracetamol', defaultStrength: '500 mg', aliases: ['crocin', 'crocin 500', 'crocin advance', 'crocin 650'] },
  { name: 'Augmentin 625', generic: 'Amoxicillin / Clavulanate', defaultStrength: '625 mg', aliases: ['augmentin', 'augmentin 625', 'augmentin duo'] },
  { name: 'Clavam 625', generic: 'Amoxicillin / Clavulanate', defaultStrength: '625 mg', aliases: ['clavam', 'clavam 625'] },
  { name: 'Combiflam', generic: 'Ibuprofen / Paracetamol', defaultStrength: '400 mg / 325 mg', aliases: ['combiflam'] },
  { name: 'Azithromycin', generic: 'Azithromycin', defaultStrength: '500 mg', aliases: ['azithromycin', 'azithral', 'aziwok', 'azithral 500'] },
  { name: 'Pantoprazole', generic: 'Pantoprazole', defaultStrength: '40 mg', aliases: ['pantoprazole', 'panto', 'pantocid', 'pantodac', 'pan 40'] },
  { name: 'Pan-D', generic: 'Pantoprazole / Domperidone', defaultStrength: '40 mg / 30 mg', aliases: ['pan-d', 'pan d', 'pantocid-d'] },
  { name: 'Cetirizine', generic: 'Cetirizine', defaultStrength: '10 mg', aliases: ['cetirizine', 'cetzine', 'okacet', 'alerid'] },
  { name: 'Montair-LC', generic: 'Montelukast / Levocetirizine', defaultStrength: '10 mg / 5 mg', aliases: ['montair-lc', 'montair lc', 'montair', 'montek-lc'] },
  { name: 'Asthalin', generic: 'Salbutamol', defaultStrength: 'Syrup / Inhaler', aliases: ['asthalin'] },
  { name: 'Ascoril', generic: 'Terbutaline / Bromhexine / Guaiphenesin', defaultStrength: 'Syrup', aliases: ['ascoril', 'ascoril-d', 'ascoril ls'] },
  { name: 'Alex Syrup', generic: 'Dextromethorphan / Chlorpheniramine / Phenylephrine', defaultStrength: 'Syrup', aliases: ['alex', 'alex syrup'] },
  { name: 'Cheston Cold', generic: 'Paracetamol / Phenylephrine / Cetirizine', defaultStrength: 'Syrup / Tablet', aliases: ['cheston cold', 'cheston'] },
  { name: 'Zerodol-SP', generic: 'Aceclofenac / Paracetamol / Serratiopeptidase', defaultStrength: '100 mg / 325 mg / 15 mg', aliases: ['zerodol-sp', 'zerodol sp', 'zerodol-p', 'zerodol'] },
  { name: 'Taxim-O', generic: 'Cefixime', defaultStrength: '200 mg', aliases: ['taxim-o', 'taxim o', 'cefixime'] },
  { name: 'Sumo', generic: 'Nimesulide / Paracetamol', defaultStrength: '100 mg / 325 mg', aliases: ['sumo'] },
  { name: 'Flexon', generic: 'Ibuprofen / Paracetamol', defaultStrength: '400 mg / 325 mg', aliases: ['flexon', 'flexon mr'] },
  { name: 'Sinarest', generic: 'Paracetamol / Chlorpheniramine / Phenylephrine', defaultStrength: 'Tablet / Syrup', aliases: ['sinarest'] },
  { name: 'Allegra', generic: 'Fexofenadine', defaultStrength: '120 mg', aliases: ['allegra', 'allegra 120', 'allegra 180'] },
  { name: 'Amoxicillin', generic: 'Amoxicillin', defaultStrength: '500 mg', aliases: ['amoxicillin', 'mox', 'novamox', 'amoxil'] },
  { name: 'Ibuprofen', generic: 'Ibuprofen', defaultStrength: '400 mg', aliases: ['ibuprofen', 'brufen'] },
  { name: 'Paracetamol', generic: 'Paracetamol', defaultStrength: '500 mg', aliases: ['paracetamol', 'acetaminophen', 'pcm'] },
  { name: 'Metformin', generic: 'Metformin', defaultStrength: '500 mg', aliases: ['metformin', 'glycomet'] },
  { name: 'Amlodipine', generic: 'Amlodipine', defaultStrength: '5 mg', aliases: ['amlodipine', 'amlong', 'stamlo'] },
]

/** Minimum similarity for an offline match. Deliberately strict. */
const OFFLINE_MATCH_FLOOR = 0.82

/**
 * Look a candidate name up in the offline dictionary.
 * Returns `{ drug, similarity }` or null. Never guesses on short fragments.
 */
export function matchOfflineDictionary(candidateName) {
  const name = (candidateName ?? '').trim()
  if (name.length < 4) return null

  let best = null
  for (const drug of KNOWN_DRUGS) {
    const references = [drug.name, drug.generic, ...drug.aliases]

    // A whole-token containment counts as certain (handles "Tab Calpol 250").
    if (references.some((reference) => containsName(name, reference))) {
      return { drug, similarity: 1 }
    }

    const { score } = bestSimilarity(name, references)
    if (score >= OFFLINE_MATCH_FLOOR && (!best || score > best.similarity)) {
      best = { drug, similarity: score }
    }
  }
  return best
}
