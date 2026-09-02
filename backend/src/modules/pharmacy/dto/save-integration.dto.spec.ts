import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SaveIntegrationDto } from './save-integration.dto';

function validateDto(body: Record<string, unknown>): {
  errors: string[];
  instance: SaveIntegrationDto;
} {
  const instance = plainToInstance(SaveIntegrationDto, body);
  const validationErrors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const errors = validationErrors.flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
  return { errors, instance };
}

describe('SaveIntegrationDto — Auth header validation and normalization', () => {
  const BASE = {
    provider: 'Marg ERP',
    feedUrl: 'https://feeds.example.com/stock.csv',
  };

  it('accepts valid HTTP header names', () => {
    ['Authorization', 'X-API-Key', 'X-Pharmacy-Key', 'Custom-Auth-123'].forEach(
      (name) => {
        const { errors, instance } = validateDto({
          ...BASE,
          authHeaderName: name,
          authHeaderValue: 'test-secret',
        });
        expect(errors).toEqual([]);
        expect(instance.authHeaderName).toBe(name);
      },
    );
  });

  it('normalizes empty and whitespace-only auth header name and value to undefined', () => {
    const { errors: err1, instance: inst1 } = validateDto({
      ...BASE,
      authHeaderName: '',
      authHeaderValue: '',
    });
    expect(err1).toEqual([]);
    expect(inst1.authHeaderName).toBeUndefined();
    expect(inst1.authHeaderValue).toBeUndefined();

    const { errors: err2, instance: inst2 } = validateDto({
      ...BASE,
      authHeaderName: '   ',
      authHeaderValue: '   ',
    });
    expect(err2).toEqual([]);
    expect(inst2.authHeaderName).toBeUndefined();
    expect(inst2.authHeaderValue).toBeUndefined();
  });

  it('preserves exact non-empty secret without trimming', () => {
    const secretWithSpaces = 'Bearer  tokenWithSpaces ';
    const { errors, instance } = validateDto({
      ...BASE,
      authHeaderName: 'Authorization',
      authHeaderValue: secretWithSpaces,
    });
    expect(errors).toEqual([]);
    expect(instance.authHeaderValue).toBe(secretWithSpaces);
  });

  it.each([
    ['header with colon', 'Authorization:'],
    ['header with spaces', 'X Header'],
    ['LF header injection', 'Test\nInjected'],
    ['CRLF header injection', 'Test\r\nAuthorization'],
    ['special characters', 'X-Auth@Key'],
  ])('rejects invalid header name: %s (%p)', (_desc, authHeaderName) => {
    const { errors } = validateDto({
      ...BASE,
      authHeaderName,
      authHeaderValue: 'secret',
    });
    expect(errors.join(' ')).toMatch(
      /authHeaderName may contain only letters, numbers and hyphens/i,
    );
  });
});
