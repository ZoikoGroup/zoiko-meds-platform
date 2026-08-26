import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { PlatformApiKeyService } from './platform-api-key.service';

/**
 * MSA-41 follow-up — the API keys tab listed three invented keys from a frontend
 * fixture, with Reveal, Rotate and Revoke behind them that had no handlers and
 * no endpoint to have handlers for.
 */
describe('PlatformApiKeyService', () => {
  let prisma: {
    platformApiKey: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let audit: { write: jest.Mock };
  let service: PlatformApiKeyService;

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'k1',
    label: 'Partner feed',
    scope: 'availability',
    keyPrefix: 'zav_1a2b3c',
    createdAt: new Date('2026-08-26T10:00:00Z'),
    lastUsedAt: null,
    revokedAt: null,
    createdBy: { fullName: 'Root' },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      platformApiKey: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
      },
    };
    audit = { write: jest.fn() };
    service = new PlatformApiKeyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
    );
  });

  describe('issuing', () => {
    it('returns the key once and stores only its hash', async () => {
      const { apiKey } = await service.create('u1', 'Partner feed', 'availability');

      const { data } = prisma.platformApiKey.create.mock.calls[0][0];
      expect(data.keyHash).toBe(createHash('sha256').update(apiKey).digest('hex'));
      // The raw value must appear nowhere in what is written.
      expect(JSON.stringify(data)).not.toContain(apiKey);
    });

    it('keeps a prefix long enough to tell keys apart and too short to use', async () => {
      const { apiKey } = await service.create('u1', 'Partner feed', 'availability');

      const { data } = prisma.platformApiKey.create.mock.calls[0][0];
      expect(apiKey.startsWith(data.keyPrefix)).toBe(true);
      expect(data.keyPrefix.length).toBeLessThan(apiKey.length / 2);
    });

    it('does not repeat a key', async () => {
      const keys = new Set<string>();
      for (let i = 0; i < 25; i += 1) {
        const { apiKey } = await service.create('u1', 'k', 'availability');
        keys.add(apiKey);
      }
      expect(keys.size).toBe(25);
    });

    // A scope nothing enforces is a label.
    it('refuses a scope outside the closed set', async () => {
      await expect(service.create('u1', 'Partner feed', 'everything')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.platformApiKey.create).not.toHaveBeenCalled();
    });

    it('records who issued it', async () => {
      await service.create('u1', 'Partner feed', 'availability', '10.0.0.1');

      expect(audit.write).toHaveBeenCalledWith(
        'u1',
        'admin.api_key.create',
        'PlatformApiKey',
        expect.any(String),
        expect.objectContaining({ scope: 'availability', module: 'Settings' }),
        '10.0.0.1',
      );
    });

    it('trims the label, so a pasted one does not sort oddly', async () => {
      await service.create('u1', '  Partner feed  ', 'availability');

      const { data } = prisma.platformApiKey.create.mock.calls[0][0];
      expect(data.label).toBe('Partner feed');
    });
  });

  describe('revoking', () => {
    it('marks the row rather than deleting it', async () => {
      prisma.platformApiKey.findUnique.mockResolvedValue(row());

      await service.revoke('u1', 'k1', '10.0.0.1');

      // A revoked key still has to be nameable in the audit trail, and its hash
      // must stay claimed so the same value can never be issued twice.
      expect(prisma.platformApiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });

    it('refuses to revoke twice', async () => {
      prisma.platformApiKey.findUnique.mockResolvedValue(row({ revokedAt: new Date() }));

      await expect(service.revoke('u1', 'k1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reports an unknown key as missing', async () => {
      prisma.platformApiKey.findUnique.mockResolvedValue(null);

      await expect(service.revoke('u1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolving a presented key', () => {
    it('looks up by hash, never comparing the raw value', async () => {
      prisma.platformApiKey.findUnique.mockResolvedValue({
        id: 'k1',
        scope: 'availability',
        revokedAt: null,
      });

      const resolved = await service.resolve('zav_abc');

      expect(prisma.platformApiKey.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { keyHash: createHash('sha256').update('zav_abc').digest('hex') },
        }),
      );
      expect(resolved).toEqual({ id: 'k1', scope: 'availability' });
    });

    it('treats a revoked key exactly like one that never existed', async () => {
      prisma.platformApiKey.findUnique.mockResolvedValue({
        id: 'k1',
        scope: 'availability',
        revokedAt: new Date(),
      });

      await expect(service.resolve('zav_abc')).resolves.toBeNull();
    });

    it('resolves nothing for a missing key', async () => {
      await expect(service.resolve(undefined)).resolves.toBeNull();
      expect(prisma.platformApiKey.findUnique).not.toHaveBeenCalled();
    });

    // Bookkeeping must not fail a request that was otherwise authorised.
    it('still authorises when the last-used write fails', async () => {
      prisma.platformApiKey.findUnique.mockResolvedValue({
        id: 'k1',
        scope: 'availability',
        revokedAt: null,
      });
      prisma.platformApiKey.update.mockRejectedValue(new Error('write failed'));

      await expect(service.resolve('zav_abc')).resolves.toEqual({
        id: 'k1',
        scope: 'availability',
      });
    });
  });

  describe('listing', () => {
    it('never includes anything a key could be reconstructed from', async () => {
      prisma.platformApiKey.findMany.mockResolvedValue([row(), row({ id: 'k2', revokedAt: new Date() })]);

      const list = await service.list();

      expect(list).toHaveLength(2);
      for (const key of list) {
        expect(key).not.toHaveProperty('keyHash');
        expect(JSON.stringify(key)).not.toMatch(/[0-9a-f]{48}/);
      }
      expect(list[0].status).toBe('active');
      expect(list[1].status).toBe('revoked');
    });
  });
});
