import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AddInventoryDto } from './add-inventory.dto';

/** Mirrors the global pipe: same class, same rules, so these are the real errors. */
function errorsFor(body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(AddInventoryDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));
}

const COMPLETE = {
  name: 'Dolo 650',
  generic: 'Paracetamol',
  strength: '650 mg',
  dosageForm: 'Tablet',
  status: 'available',
};

describe('AddInventoryDto — a medicine cannot be created half-described (MP-46)', () => {
  it('accepts a fully described medicine', () => {
    expect(errorsFor(COMPLETE)).toEqual([]);
  });

  it.each([
    ['generic', /Generic name is required/i],
    ['strength', /Strength is required/i],
    ['dosageForm', /Dosage form is required/i],
    ['name', /Medicine name is required/i],
  ])('refuses a request with no %s', (field, message) => {
    // Adding to inventory creates the MediBase identity when nothing matches, so
    // a blank here is a blank in the catalog every patient searches.
    const { [field]: _omitted, ...body } = COMPLETE as Record<string, unknown>;

    expect(errorsFor(body).join(' ')).toMatch(message);
  });

  it.each(['', '   '])('treats %p as absent rather than as an answer', (value) => {
    expect(errorsFor({ ...COMPLETE, strength: value }).join(' ')).toMatch(
      /Strength is required/i,
    );
  });

  it('accepts the older lowercase dosageform spelling', () => {
    // The global pipe rejects unknown properties, so dropping the alias would turn
    // an older client's request into a validation error instead of a medicine.
    const { dosageForm: _renamed, ...body } = COMPLETE;

    expect(errorsFor({ ...body, dosageform: 'Syrup' })).toEqual([]);
  });

  it('still requires a dosage form when neither spelling carries one', () => {
    const { dosageForm: _renamed, ...body } = COMPLETE;

    expect(errorsFor({ ...body, dosageform: '  ' }).join(' ')).toMatch(
      /Dosage form is required/i,
    );
  });

  it('leaves availability optional, defaulting is the service\'s business', () => {
    const { status: _optional, ...body } = COMPLETE;

    expect(errorsFor(body)).toEqual([]);
  });

  it('rejects an availability value outside the three the platform models', () => {
    expect(errorsFor({ ...COMPLETE, status: 'plenty' }).join(' ')).toMatch(/status/i);
  });

  it('bounds the free-text fields', () => {
    expect(errorsFor({ ...COMPLETE, strength: 'x'.repeat(61) }).join(' ')).toMatch(
      /shorter than or equal to 60/i,
    );
  });
});
