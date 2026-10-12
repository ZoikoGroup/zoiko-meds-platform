import { MedibaseService } from '../medibase/medibase.service';
import {
  PrescriptionMatcherService,
  compareStrength,
} from './prescription-matcher.service';
import type { ExtractedMedicine } from './gemini-prescription.service';

/**
 * Where a reading becomes an identity.
 *
 * The rule this file exists to hold: the catalog decides, and when it cannot
 * decide confidently the patient is asked rather than told. A wrong medicine
 * presented confidently is the worst outcome this feature can produce, so
 * nearly every test here is about refusing to choose.
 */

const matchMedicines = jest.fn();
const medibase = { matchMedicines } as unknown as MedibaseService;
const service = () => new PrescriptionMatcherService(medibase);

const read = (over: Partial<ExtractedMedicine> = {}): ExtractedMedicine => ({
  rawText: 'Dolo 650 mg',
  name: 'Dolo',
  strength: '650 mg',
  dosageForm: null,
  dose: null,
  frequency: null,
  duration: null,
  route: null,
  instructions: null,
  isUncertain: false,
  uncertainFields: [],
  uncertainText: null,
  ...over,
});

/** A line the reader could not make out, shaped the way the reader emits it. */
const unreadable = (over: Partial<ExtractedMedicine> = {}): ExtractedMedicine =>
  read({
    rawText: 'Amo... 500',
    name: null,
    strength: '500 mg',
    isUncertain: true,
    uncertainFields: ['name'],
    uncertainText: 'Amo... 500',
    ...over,
  });

/** A catalog row shaped like the one MediBase actually returns. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'med_dolo',
  canonicalName: 'Dolo 650',
  genericName: 'Paracetamol',
  manufacturer: 'Micro Labs Ltd',
  strength: '650 mg',
  dosageForm: 'Tablet',
  score: 0.95,
  ...over,
});

beforeEach(() => {
  matchMedicines.mockReset();
});

describe('compareStrength', () => {
  it('matches the same strength written differently', () => {
    expect(compareStrength('650 mg', '650mg')).toBe('match');
  });

  it('matches across units, which string comparison never could', () => {
    // The gap this closes: "0.65g" and "650mg" are the same dose and were
    // previously two different strings, so a correct prescription read as grams
    // would have failed to corroborate its own catalog entry.
    expect(compareStrength('0.65 g', '650 mg')).toBe('match');
    expect(compareStrength('500 mcg', '0.5 mg')).toBe('match');
    expect(compareStrength('1 g', '1000 mg')).toBe('match');
  });

  it('reports a genuine difference as a mismatch', () => {
    expect(compareStrength('500 mg', '250 mg')).toBe('mismatch');
    expect(compareStrength('650 mg', '0.5 g')).toBe('mismatch');
  });

  it('treats an absent strength as unknown, not as disagreement', () => {
    expect(compareStrength(null, '650 mg')).toBe('unknown');
    expect(compareStrength('650 mg', null)).toBe('unknown');
    expect(compareStrength('as directed', '650 mg')).toBe('unknown');
  });

  it('matches a ratio strength on either of its numbers', () => {
    expect(compareStrength('250mg/5ml', '250 mg')).toBe('match');
  });
});

describe('MATCHED', () => {
  it('returns the catalog identity when one entry is clearly strongest', async () => {
    matchMedicines.mockResolvedValue([row()]);

    const [result] = await service().verifyAll([read()]);

    expect(result.verification.status).toBe('MATCHED');
    expect(result.verification.medicine).toEqual({
      id: 'med_dolo',
      brandName: 'Dolo 650',
      genericName: 'Paracetamol',
      strength: '650 mg',
      manufacturer: 'Micro Labs Ltd',
      dosageForm: 'Tablet',
    });
    expect(result.verification.candidates).toEqual([]);
  });

  it('keeps the raw reading alongside the identity, so a human can check it', async () => {
    matchMedicines.mockResolvedValue([row()]);

    const [result] = await service().verifyAll([read({ rawText: '1) Dolo 650 mg  BD' })]);

    expect(result.extracted.rawText).toBe('1) Dolo 650 mg  BD');
  });

  it('matches when the strength agrees only after unit conversion', async () => {
    matchMedicines.mockResolvedValue([row()]);

    const [result] = await service().verifyAll([read({ strength: '0.65 g' })]);

    expect(result.verification.status).toBe('MATCHED');
  });

  it('takes the identity from the catalog, never from the reading', async () => {
    // The reading says nothing about a generic or a manufacturer — it cannot —
    // so everything canonical in the answer has to have come from MediBase.
    matchMedicines.mockResolvedValue([row()]);

    const [result] = await service().verifyAll([read({ name: 'DOLO', strength: '650mg' })]);

    expect(result.verification.medicine?.genericName).toBe('Paracetamol');
    expect(result.verification.medicine?.manufacturer).toBe('Micro Labs Ltd');
  });
});

describe('AMBIGUOUS', () => {
  it('refuses to choose between two close candidates', async () => {
    matchMedicines.mockResolvedValue([
      row({ id: 'a', canonicalName: 'Pan 40', score: 0.9, strength: '40 mg' }),
      row({ id: 'b', canonicalName: 'Pantop 40', score: 0.88, strength: '40 mg' }),
    ]);

    const [result] = await service().verifyAll([read({ name: 'Pan', strength: '40 mg' })]);

    expect(result.verification.status).toBe('AMBIGUOUS');
    expect(result.verification.medicine).toBeNull();
    expect(result.verification.candidates.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('refuses a weak lead even when it is the only candidate', async () => {
    matchMedicines.mockResolvedValue([row({ score: 0.55 })]);

    const [result] = await service().verifyAll([read()]);

    expect(result.verification.status).toBe('AMBIGUOUS');
    expect(result.verification.medicine).toBeNull();
  });

  it('never silently accepts a strength that disagrees', async () => {
    // 500 mg read against a 250 mg catalog entry is a different thing to
    // dispense. The patient is asked; nothing is chosen for them.
    matchMedicines.mockResolvedValue([
      row({ id: 'amox250', canonicalName: 'Amoxicillin 250', strength: '250 mg', score: 0.97 }),
    ]);

    const [result] = await service().verifyAll([
      read({ name: 'Amoxicillin', strength: '500 mg', rawText: 'Amoxicillin 500 mg' }),
    ]);

    expect(result.verification.status).toBe('AMBIGUOUS');
    expect(result.verification.medicine).toBeNull();
    expect(result.verification.reason).toMatch(/500 mg/);
    expect(result.verification.candidates.map((c) => c.id)).toEqual(['amox250']);
  });

  it('prefers the candidate whose strength agrees when both are plausible', async () => {
    matchMedicines.mockResolvedValue([
      row({ id: 'wrong', canonicalName: 'Dolo 500', strength: '500 mg', score: 0.93 }),
      row({ id: 'right', canonicalName: 'Dolo 650', strength: '650 mg', score: 0.9 }),
    ]);

    const [result] = await service().verifyAll([read({ strength: '650 mg' })]);

    expect(result.verification.status).toBe('MATCHED');
    expect(result.verification.medicine?.id).toBe('right');
  });

  it('always gives a reason the patient can act on', async () => {
    matchMedicines.mockResolvedValue([row({ score: 0.6 }), row({ id: 'b', score: 0.58 })]);

    const [result] = await service().verifyAll([read()]);

    expect(result.verification.reason).toBeTruthy();
  });
});

describe('NOT_FOUND', () => {
  it('reports nothing found, keeping the reading for a manual search', async () => {
    matchMedicines.mockResolvedValue([]);

    const [result] = await service().verifyAll([
      read({ name: 'Zyxiva', strength: '100 mg', rawText: 'Zyxiva 100 mg' }),
    ]);

    expect(result.verification.status).toBe('NOT_FOUND');
    expect(result.verification.medicine).toBeNull();
    expect(result.extracted.name).toBe('Zyxiva');
    expect(result.extracted.strength).toBe('100 mg');
    expect(result.extracted.rawText).toBe('Zyxiva 100 mg');
  });

  it('discards candidates too weak to be a plausible reading at all', async () => {
    matchMedicines.mockResolvedValue([row({ score: 0.2 })]);

    const [result] = await service().verifyAll([read()]);

    expect(result.verification.status).toBe('NOT_FOUND');
  });

  it('does not fail the whole scan when the catalog is unreachable', async () => {
    matchMedicines.mockRejectedValue(new Error('connection refused'));

    const [result] = await service().verifyAll([read()]);

    expect(result.verification.status).toBe('NOT_FOUND');
    expect(result.extracted.name).toBe('Dolo');
  });
});

describe('several medicines on one prescription', () => {
  it('verifies each independently', async () => {
    matchMedicines.mockImplementation((q: string) => {
      if (/dolo/i.test(q)) return Promise.resolve([row()]);
      if (/pantop/i.test(q)) {
        return Promise.resolve([
          row({ id: 'pan', canonicalName: 'Pantop 40', genericName: 'Pantoprazole', strength: '40 mg' }),
        ]);
      }
      return Promise.resolve([]);
    });

    const results = await service().verifyAll([
      read(),
      read({ name: 'Pantop', strength: '40 mg', rawText: 'Pantop 40' }),
      read({ name: 'Zyxiva', strength: '100 mg', rawText: 'Zyxiva 100' }),
    ]);

    expect(results.map((r) => r.verification.status)).toEqual([
      'MATCHED',
      'MATCHED',
      'NOT_FOUND',
    ]);
    expect(results[1].verification.medicine?.genericName).toBe('Pantoprazole');
  });

  it('keeps results in the order they were read', async () => {
    matchMedicines.mockResolvedValue([]);

    const results = await service().verifyAll([
      read({ name: 'A', strength: '1 mg', rawText: 'A' }),
      read({ name: 'B', strength: '2 mg', rawText: 'B' }),
      read({ name: 'C', strength: '3 mg', rawText: 'C' }),
      read({ name: 'D', strength: '4 mg', rawText: 'D' }),
      read({ name: 'E', strength: '5 mg', rawText: 'E' }),
    ]);

    expect(results.map((r) => r.extracted.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('collapses a medicine restated on a continuation page', async () => {
    matchMedicines.mockResolvedValue([row()]);

    const results = await service().verifyAll([read(), read()]);

    expect(results).toHaveLength(1);
  });

  it('keeps two strengths of the same medicine apart', async () => {
    // A taper is two doses of one medicine, not a repetition. Merging them
    // would silently drop a dose from the prescription.
    matchMedicines.mockResolvedValue([row()]);

    const results = await service().verifyAll([
      read({ strength: '650 mg' }),
      read({ strength: '500 mg' }),
    ]);

    expect(results).toHaveLength(2);
  });
});

describe('how it queries the catalog', () => {
  it('asks with name and strength first, as the most specific reading', async () => {
    matchMedicines.mockResolvedValue([row()]);

    await service().verifyAll([read()]);

    expect(matchMedicines).toHaveBeenCalledWith('Dolo 650 mg', expect.anything());
  });

  it('falls back to the raw line, then the bare name, when nothing matches', async () => {
    matchMedicines.mockResolvedValue([]);

    await service().verifyAll([read({ name: 'Dolo', strength: '650 mg', rawText: '1) Dolo 650 mg BD' })]);

    // The raw line arrives normalized — punctuation that is not part of a name
    // or a strength is collapsed, so the list marker "1)" becomes "1". That is
    // formatting, not a spelling change: no letter of the medicine is touched.
    const queries = matchMedicines.mock.calls.map((c) => c[0]);
    expect(queries[0]).toBe('Dolo 650 mg');
    expect(queries).toContain('1 Dolo 650 mg BD');
    expect(queries).toContain('Dolo');
  });

  it('normalizes formatting without altering the spelling of a medicine', async () => {
    matchMedicines.mockResolvedValue([]);

    await service().verifyAll([
      read({ name: 'Dolo-650', strength: null, rawText: 'Dolo‑650   Tab.' }),
    ]);

    const queries = matchMedicines.mock.calls.map((c) => c[0]);
    // Dashes unified, runs of space collapsed; "Dolo" never becomes "Dola".
    expect(queries.every((q: string) => /dolo/i.test(q))).toBe(true);
    expect(queries.some((q: string) => q.includes('  '))).toBe(false);
  });

  it('stops at the first query that finds something', async () => {
    matchMedicines.mockResolvedValue([row()]);

    await service().verifyAll([read()]);

    expect(matchMedicines).toHaveBeenCalledTimes(1);
  });
});

/**
 * Handwriting.
 *
 * The rule the whole feature stands on: a medicine nobody could read must never
 * become a medicine somebody might take. The catalog's nearest neighbour to
 * "Amo... 500" is Amoxicillin 500 mg, and that is exactly the answer this must
 * refuse to give on its own.
 */
describe('USER_CONFIRMATION_REQUIRED', () => {
  it('never matches a medicine whose name could not be read', async () => {
    matchMedicines.mockResolvedValue([
      row({ id: 'amox', canonicalName: 'Amoxicillin 500 mg', genericName: 'Amoxicillin', strength: '500 mg', score: 0.99 }),
    ]);

    const [result] = await service().verifyAll([unreadable()]);

    expect(result.verification.status).toBe('USER_CONFIRMATION_REQUIRED');
    expect(result.verification.medicine).toBeNull();
  });

  it('offers what the catalog has as choices, not as an answer', async () => {
    matchMedicines.mockResolvedValue([
      row({ id: 'a', canonicalName: 'Amoxicillin 500 mg', strength: '500 mg', score: 0.95 }),
      row({ id: 'b', canonicalName: 'Amox 500', strength: '500 mg', score: 0.9 }),
      row({ id: 'c', canonicalName: 'Amoxicillin + Clavulanate 500/125', strength: '500 mg', score: 0.8 }),
    ]);

    const [result] = await service().verifyAll([unreadable()]);

    expect(result.verification.candidates.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(result.verification.reason).toMatch(/couldn't confidently read/i);
  });

  it('still asks, even when the catalog has nothing to suggest', async () => {
    matchMedicines.mockResolvedValue([]);

    const [result] = await service().verifyAll([unreadable()]);

    expect(result.verification.status).toBe('USER_CONFIRMATION_REQUIRED');
    expect(result.verification.candidates).toEqual([]);
    expect(result.verification.reason).toMatch(/search for it/i);
  });

  it('treats a name flagged uncertain the same as a missing one', async () => {
    matchMedicines.mockResolvedValue([row({ score: 0.99 })]);

    const [result] = await service().verifyAll([
      read({ name: 'Dolo', isUncertain: true, uncertainFields: ['name'], uncertainText: 'D?lo' }),
    ]);

    expect(result.verification.status).toBe('USER_CONFIRMATION_REQUIRED');
  });

  it('keeps the raw reading so the patient sees what was on the page', async () => {
    matchMedicines.mockResolvedValue([]);

    const [result] = await service().verifyAll([unreadable()]);

    expect(result.extracted.rawText).toBe('Amo... 500');
    expect(result.extracted.uncertainText).toBe('Amo... 500');
    expect(result.extracted.name).toBeNull();
  });

  it('searches on the legible glyphs, with the placeholders dropped', async () => {
    // "Amo... 500" matches nothing literally; "Amo 500" at least gives the
    // patient something to choose from. Widening the search is not completing
    // the word.
    matchMedicines.mockResolvedValue([]);

    await service().verifyAll([unreadable()]);

    const queries = matchMedicines.mock.calls.map((c) => c[0]);
    expect(queries[0]).toBe('Amo 500');
    expect(queries.some((q: string) => q.includes('...'))).toBe(false);
  });

  it('does not collapse two unreadable lines into one medicine', async () => {
    matchMedicines.mockResolvedValue([]);

    const results = await service().verifyAll([
      unreadable({ rawText: 'Amo... 500', uncertainText: 'Amo... 500' }),
      unreadable({ rawText: 'Pant... 40', uncertainText: 'Pant... 40', strength: '40 mg' }),
    ]);

    expect(results).toHaveLength(2);
  });
});

describe('an unreadable strength', () => {
  it('asks which dose was prescribed rather than picking one', async () => {
    matchMedicines.mockResolvedValue([
      row({ id: 'd650', canonicalName: 'Dolo 650', strength: '650 mg', score: 0.95 }),
      row({ id: 'd500', canonicalName: 'Dolo 500', strength: '500 mg', score: 0.9 }),
    ]);

    const [result] = await service().verifyAll([
      read({ rawText: 'Dolo ?50', strength: null, isUncertain: true, uncertainFields: ['strength'], uncertainText: 'Dolo ?50' }),
    ]);

    expect(result.verification.status).toBe('USER_CONFIRMATION_REQUIRED');
    expect(result.verification.medicine).toBeNull();
    expect(result.verification.candidates.map((c) => c.strength)).toEqual(['650 mg', '500 mg']);
    expect(result.verification.reason).toMatch(/strength/i);
  });

  it('offers one entry per distinct strength, not per catalog row', async () => {
    matchMedicines.mockResolvedValue([
      row({ id: 'a', canonicalName: 'Dolo 650', strength: '650 mg', score: 0.95 }),
      row({ id: 'b', canonicalName: 'Dolo 650 Tab', strength: '650 mg', score: 0.93 }),
      row({ id: 'c', canonicalName: 'Dolo 500', strength: '500 mg', score: 0.9 }),
    ]);

    const [result] = await service().verifyAll([
      read({ strength: null, isUncertain: true, uncertainFields: ['strength'] }),
    ]);

    expect(result.verification.candidates.map((c) => c.strength)).toEqual(['650 mg', '500 mg']);
  });
});

describe('a prescription with mixed certainty', () => {
  it('settles what it can and asks only about what it cannot', async () => {
    matchMedicines.mockImplementation((q: string) => {
      if (/dolo/i.test(q)) return Promise.resolve([row()]);
      if (/azithral/i.test(q)) {
        return Promise.resolve([row({ id: 'az', canonicalName: 'Azithral 500', strength: '500 mg' })]);
      }
      if (/pant/i.test(q)) {
        return Promise.resolve([row({ id: 'pan', canonicalName: 'Pantop 40', strength: '40 mg', score: 0.7 })]);
      }
      return Promise.resolve([]);
    });

    const results = await service().verifyAll([
      read(),
      unreadable({ rawText: 'Pant... ??', uncertainText: 'Pant... ??', strength: null }),
      read({ name: 'Azithral', strength: '500 mg', rawText: 'Azithral 500' }),
    ]);

    expect(results.map((r) => r.verification.status)).toEqual([
      'MATCHED',
      'USER_CONFIRMATION_REQUIRED',
      'MATCHED',
    ]);
    // The two that read cleanly are usable immediately; one unclear line does
    // not cost the patient the whole prescription.
    expect(results[0].verification.medicine?.id).toBe('med_dolo');
    expect(results[2].verification.medicine?.id).toBe('az');
  });
});
