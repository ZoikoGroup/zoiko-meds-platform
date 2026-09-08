import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
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

  /**
   * A client error's payload reaches the client whole (MSA-42).
   *
   * The envelope used to be rebuilt from `message` and `error` alone, and every
   * other field a thrower had attached was dropped on the floor. Most failures
   * only need their sentence; some carry a fact the client has to act on.
   *
   * The one that broke in production: `AuthService.login` refuses an enrolled
   * administrator with `{ message, mfaRequired: true }`, and the login form
   * shows its code field from that flag — deliberately from the flag and not
   * from the wording, because a copy edit must not be able to take an
   * administrator's sign-in away. The flag was stripped here, so the form
   * printed "Enter the code from your authenticator app" with nowhere to type
   * one, and the account could not get in at all.
   *
   * Both halves had tests. AuthService's assert on the thrown exception, which
   * is this filter's input; the login form's fake the response body, which is
   * this filter's output. Nothing asserted the join, so this does.
   */
  describe('a structured reason survives the envelope', () => {
    /** Exactly what AuthService.login throws for an enrolled account. */
    const mfaRefusal = () =>
      new UnauthorizedException({
        message: 'Enter the code from your authenticator app.',
        mfaRequired: true,
      });

    it('keeps mfaRequired, which is what makes the code field appear', () => {
      const { host, status, body } = hostFor('POST', '/api/auth/login');

      filter.catch(mfaRefusal(), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(body().mfaRequired).toBe(true);
    });

    it('answers with the whole envelope the login form reads', () => {
      // Asserted as a shape rather than field by field: the bug was a missing
      // key, and only an exact comparison fails when one goes missing again.
      const { host, body } = hostFor('POST', '/api/auth/login');

      filter.catch(mfaRefusal(), host);

      expect(body()).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Enter the code from your authenticator app.',
        mfaRequired: true,
        path: '/api/auth/login',
        requestId: 'req_1',
        timestamp: expect.any(String),
      });
    });

    it('keeps mfaRequired on a rejected code, so the field stays up', () => {
      // The second attempt matters as much as the first: losing the flag here
      // would take the field away the moment somebody mistyped, and strand them
      // on a form that had just told them to try the current code.
      const { host, body } = hostFor('POST', '/api/auth/login');

      filter.catch(
        new UnauthorizedException({
          message: 'That code is not right. Try the current one.',
          mfaRequired: true,
        }),
        host,
      );

      expect(body().mfaRequired).toBe(true);
      expect(body().message).toBe('That code is not right. Try the current one.');
    });

    it('keeps mfaEnrolmentRequired, which asks for something else entirely', () => {
      // A different state with a different remedy: the workspace requires a
      // factor this account never set up, so there is no code to type and the
      // form must not offer a field. It can only tell the two apart by the flag.
      const { host, body } = hostFor('POST', '/api/auth/login');

      filter.catch(
        new UnauthorizedException({
          message:
            'This workspace requires administrators to use an authenticator app. Set one up from the settings page of an account that still has access.',
          mfaEnrolmentRequired: true,
        }),
        host,
      );

      expect(body().mfaEnrolmentRequired).toBe(true);
      expect(body().mfaRequired).toBeUndefined();
    });

    it('carries any field, not a list of the ones we thought of', () => {
      const { host, body } = hostFor();

      filter.catch(
        new BadRequestException({ message: 'Nope', retryAfterSeconds: 30, code: 'X1' }),
        host,
      );

      expect(body().retryAfterSeconds).toBe(30);
      expect(body().code).toBe('X1');
    });
  });

  describe('the envelope stays authoritative', () => {
    it('ignores a payload restating the fields this filter owns', () => {
      // Not a hypothetical: `statusCode` is in the payload of every built-in
      // Nest exception. A payload that could displace these would let a thrower
      // report a 500 as a 200, or point `path` at a request that never happened.
      const { host, status, body } = hostFor('POST', '/api/auth/login');

      filter.catch(
        new UnauthorizedException({
          message: 'Enter the code from your authenticator app.',
          mfaRequired: true,
          statusCode: 200,
          error: 'OK',
          path: '/somewhere/else',
          requestId: 'req_forged',
          timestamp: 'not-a-time',
        }),
        host,
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(body().statusCode).toBe(401);
      expect(body().path).toBe('/api/auth/login');
      expect(body().requestId).toBe('req_1');
      expect(body().timestamp).not.toBe('not-a-time');
      // `error` and `message` are read off the payload on purpose and always
      // were — a thrower naming its own is the documented behaviour above.
      expect(body().error).toBe('OK');
      // And the flag still arrives.
      expect(body().mfaRequired).toBe(true);
    });

    it('adds nothing when the exception threw a bare string', () => {
      // Passport's rejection, and the shape most of the app throws.
      const { host, body } = hostFor();

      filter.catch(new NotFoundException('Pharmacy not found'), host);

      expect(Object.keys(body()).sort()).toEqual([
        'error',
        'message',
        'path',
        'requestId',
        'statusCode',
        'timestamp',
      ]);
    });

    it('leaves a validation failure exactly as it was', () => {
      // ValidationPipe throws `{ statusCode, error, message: [...] }` — all
      // three reserved, so nothing new is carried and the shape is unchanged.
      const { host, body } = hostFor();

      filter.catch(new BadRequestException({ message: ['too short'], error: 'Bad Request' }), host);

      expect(body().message).toEqual(['too short']);
      expect(Object.keys(body()).sort()).toEqual([
        'error',
        'message',
        'path',
        'requestId',
        'statusCode',
        'timestamp',
      ]);
    });

    it('carries nothing out of a server fault, however it was thrown', () => {
      // The line this filter exists to hold: 5xx payloads are where internal
      // detail collects, and a client error's transparency must not become a
      // server error's. /health throws a 503 with an object today and is
      // unaffected — it was already answered by the envelope alone.
      const { host, status, body } = hostFor('GET', '/api/health');

      filter.catch(
        new ServiceUnavailableException({ status: 'error', service: 'zoikomeds-api', db: 'down' }),
        host,
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body().db).toBeUndefined();
      expect(body().service).toBeUndefined();
    });
  });
});
