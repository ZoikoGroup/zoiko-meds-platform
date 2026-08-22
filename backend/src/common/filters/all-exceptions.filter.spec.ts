import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger } from '../logger/app-logger.service';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Minimal ArgumentsHost double: the filter only reads the request and writes JSON. */
function hostFor(method = 'POST', url = '/api/me/saved') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method, originalUrl: url, id: 'req_1' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json, body: () => json.mock.calls[0][0] };
}

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('query failed', {
    code,
    clientVersion: '5.22.0',
    meta,
  });

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let logError: jest.SpyInstance;
  let logWarn: jest.SpyInstance;

  beforeEach(() => {
    // The filter builds its own logger, so silence the class rather than the
    // console — and keep the calls to assert what the operator is told.
    logError = jest.spyOn(AppLogger.prototype, 'error').mockImplementation(() => undefined);
    logWarn = jest.spyOn(AppLogger.prototype, 'warn').mockImplementation(() => undefined);
    filter = new AllExceptionsFilter();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('a schema behind the code is reported as such, not as a bug', () => {
    // The reported incident: SavedMedicine queries failed with a bare 500 because
    // a migration had not been applied, which reads as an application fault and
    // sent everyone looking for a bug in code that was correct.
    it('maps a missing column to 503 and says the schema is behind', () => {
      const { host, status, body } = hostFor();

      filter.catch(prismaError('P2022', { column: 'SavedMedicine.medicineName' }), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body().error).toBe('Service Unavailable');
      expect(body().message).toMatch(/database schema is behind the deployed application/i);
      expect(body().message).toMatch(/pending migration/i);
    });

    it('maps a missing table the same way', () => {
      const { host, status, body } = hostFor('GET', '/api/me/signal/notifications');

      filter.catch(prismaError('P2021', { table: 'SavedMedicine' }), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body().message).toMatch(/database schema is behind/i);
    });

    it('keeps the missing identifier out of the response but puts it in the log', () => {
      // Schema detail belongs in the log, not in a reply to a patient's browser —
      // and the log has to name it, or the operator is no better off.
      const { host, body } = hostFor();

      filter.catch(prismaError('P2022', { column: 'SavedMedicine.medicineName' }), host);

      expect(JSON.stringify(body())).not.toMatch(/medicineName/);
      expect(logError).toHaveBeenCalledWith(
        expect.stringMatching(/SCHEMA DRIFT \(P2022\).*SavedMedicine\.medicineName.*migrate deploy/s),
        undefined,
        'Exception',
      );
    });

    it('logs once, without a stack that would only name the first query to notice', () => {
      const { host } = hostFor();

      filter.catch(prismaError('P2022', { column: 'SavedMedicine.medicineName' }), host);

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logWarn).not.toHaveBeenCalled();
    });

    it('leaves every other Prisma failure as an opaque 500', () => {
      // P2002 and friends are handled by the services that can say something
      // useful about them; anything reaching here is still an internal fault.
      const { host, status, body } = hostFor();

      filter.catch(prismaError('P2002', { target: ['userId'] }), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body().message).toBe('Internal server error');
    });
  });

  describe('the envelope names the status it actually carries (MP-18)', () => {
    it('reports a rejected token as Unauthorized, not Internal Server Error', () => {
      // Passport throws UnauthorizedException with no `error` of its own, so the
      // envelope used to label a dead session "Internal Server Error" — which is
      // what made an expired token look like a server crash.
      const { host, status, body } = hostFor('POST', '/api/auth/change-password');

      filter.catch(new UnauthorizedException(), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(body().error).toBe('Unauthorized');
      expect(body().statusCode).toBe(401);
    });

    it('derives the name for other statuses the same way', () => {
      const { host, body } = hostFor('GET', '/api/medicines/nope');

      filter.catch(new NotFoundException(), host);

      expect(body().error).toBe('Not Found');
    });

    it('still prefers an error the exception named itself', () => {
      // Nest's validation pipe supplies error: 'Bad Request' explicitly.
      const { host, body } = hostFor();

      filter.catch(new BadRequestException({ message: ['too short'], error: 'Bad Request' }), host);

      expect(body().error).toBe('Bad Request');
      expect(body().message).toEqual(['too short']);
    });

    it('keeps Internal Server Error for a genuine fault', () => {
      const { host, body } = hostFor();

      filter.catch(new Error('boom'), host);

      expect(body().error).toBe('Internal Server Error');
    });
  });

  it('passes a client error through untouched', () => {
    const { host, status, body } = hostFor();

    filter.catch(new BadRequestException('Provide a medicineId or a medicine name'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(body().message).toBe('Provide a medicineId or a medicine name');
  });

  it('hides an unexpected error behind a generic message', () => {
    const { host, status, body } = hostFor();

    filter.catch(new Error('connect ECONNREFUSED 10.0.0.5:5432'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body().message).toBe('Internal server error');
    expect(JSON.stringify(body())).not.toMatch(/ECONNREFUSED/);
  });

  it('carries the request id so a report can be traced to one request', () => {
    const { host, body } = hostFor();

    filter.catch(prismaError('P2022', { column: 'SavedMedicine.medicineName' }), host);

    expect(body().requestId).toBe('req_1');
    expect(body().path).toBe('/api/me/saved');
  });
});
