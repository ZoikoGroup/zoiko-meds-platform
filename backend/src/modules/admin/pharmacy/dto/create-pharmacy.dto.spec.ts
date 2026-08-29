// CreatePharmacyDto's latitude/longitude fields use class-transformer's
// @Type(() => Number), which reads metadata via reflect-metadata. In the real
// app this is already polyfilled by the time any DTO loads (main.ts pulls in
// @nestjs/common, which imports it); a spec that imports only this DTO
// directly needs the same polyfill loaded first.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePharmacyDto } from './create-pharmacy.dto';

/** Mirrors the global pipe: same class, same rules, so these are the real errors. */
function errorsFor(body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(CreatePharmacyDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));
}

const COMPLETE = {
  name: 'HealthBridge Pharmacy',
  licenseNumber: 'LC-109283',
  addressLine1: '214 W Kinzie St',
  city: 'Chicago',
  region: 'Illinois',
  postalCode: '60654',
  country: 'United States',
  phone: '+1 312 555 0142',
};

describe('CreatePharmacyDto — a pharmacy cannot be registered with no location (MSA-33)', () => {
  it('accepts a fully described pharmacy', () => {
    expect(errorsFor(COMPLETE)).toEqual([]);
  });

  it.each([
    ['city', /City is required/i],
    ['country', /Country is required/i],
  ])('refuses a request with no %s', (field, message) => {
    // Without both, geocoding has nothing to resolve, so the pharmacy would
    // save with no coordinates and be invisible to every distance-bounded
    // patient search — a silently broken record rather than a rejected one.
    const { [field]: _omitted, ...body } = COMPLETE as Record<string, unknown>;

    expect(errorsFor(body).join(' ')).toMatch(message);
  });

  it.each(['', '   '])('treats %p city as absent rather than as an answer', (value) => {
    expect(errorsFor({ ...COMPLETE, city: value }).join(' ')).toMatch(/City is required/i);
  });

  it.each(['', '   '])('treats %p country as absent rather than as an answer', (value) => {
    expect(errorsFor({ ...COMPLETE, country: value }).join(' ')).toMatch(/Country is required/i);
  });
});
