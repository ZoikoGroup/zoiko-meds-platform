import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../../admin/audit.writer';
import {
  MAX_LOGO_BYTES,
  PharmacyLogoService,
  UploadedLogo,
  logoUrlFor,
  withLogoUrl,
} from './pharmacy-logo.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
]);

const upload = (buffer: Buffer, over: Partial<UploadedLogo> = {}): UploadedLogo => ({
  buffer,
  size: buffer.length,
  mimetype: 'image/png',
  originalname: 'logo.png',
  ...over,
});

describe('PharmacyLogoService', () => {
  let service: PharmacyLogoService;
  let prisma: any;
  let audit: { write: jest.Mock };

  beforeEach(() => {
    prisma = {
      pharmacy: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ph_1' }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      pharmacyLogo: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    audit = { write: jest.fn() };
    service = new PharmacyLogoService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditWriter,
    );
  });

  describe('what may be stored', () => {
    it.each([
      ['PNG', PNG, 'image/png'],
      ['JPEG', JPEG, 'image/jpeg'],
      ['WebP', WEBP, 'image/webp'],
    ])('accepts a %s and records the type it actually is', async (_label, bytes, mimeType) => {
      const stored = await service.save('ph_1', upload(bytes as Buffer));

      expect(stored.mimeType).toBe(mimeType);
      expect(stored.byteSize).toBe((bytes as Buffer).length);
      expect(prisma.pharmacyLogo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pharmacyId: 'ph_1' },
          update: expect.objectContaining({ mimeType, byteSize: (bytes as Buffer).length }),
        }),
      );
    });

    it('believes the bytes, not the content type the client claimed', async () => {
      // A JPEG announced as a PNG is stored, and later served, as a JPEG.
      const stored = await service.save('ph_1', upload(JPEG, { mimetype: 'image/png' }));

      expect(stored.mimeType).toBe('image/jpeg');
    });

    it('rejects a script that calls itself an image', async () => {
      // The declared type is written by the client. Were it trusted, this file
      // would afterwards be served from our own origin as image/png.
      const html = Buffer.from('<script>alert(1)</script>', 'utf8');

      await expect(
        service.save('ph_1', upload(html, { mimetype: 'image/png' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pharmacyLogo.upsert).not.toHaveBeenCalled();
    });

    it('rejects SVG, which is a document that can carry script', async () => {
      const svg = Buffer.from('<svg><script/></svg>', 'utf8');

      await expect(
        service.save('ph_1', upload(svg, { mimetype: 'image/svg+xml' })),
      ).rejects.toThrow(/not a PNG, JPEG or WebP/i);
    });

    it('rejects an image over the size cap', async () => {
      const huge = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]);

      await expect(service.save('ph_1', upload(huge))).rejects.toThrow(/too large/i);
      expect(prisma.pharmacyLogo.upsert).not.toHaveBeenCalled();
    });

    it('asks for a file when none was attached', async () => {
      await expect(service.save('ph_1', undefined)).rejects.toThrow(/Choose an image file/i);
    });

    it('refuses to store against a pharmacy that does not exist', async () => {
      prisma.pharmacy.findUnique.mockResolvedValue(null);

      await expect(service.save('ph_missing', upload(PNG))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('the image and the timestamp move together', () => {
    it('writes both in one transaction', async () => {
      // Apart, either half can commit alone: an image nothing points at, or a URL
      // that renders as a broken picture for every patient.
      await service.save('ph_1', upload(PNG));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.pharmacyLogo.upsert).toHaveBeenCalled();
      expect(prisma.pharmacy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ph_1' } }),
      );
    });

    it('clears both when the logo is removed', async () => {
      await service.remove('ph_1');

      expect(prisma.pharmacyLogo.deleteMany).toHaveBeenCalledWith({
        where: { pharmacyId: 'ph_1' },
      });
      expect(prisma.pharmacy.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { logoUpdatedAt: null } }),
      );
    });

    it('treats removing a logo that is not there as success', async () => {
      prisma.pharmacyLogo.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('ph_1')).resolves.toBeUndefined();
      // Nothing was removed, so nothing is recorded as having been.
      expect(audit.write).not.toHaveBeenCalled();
    });
  });

  it('records an upload with both the type it was told and the type it found', async () => {
    await service.save('ph_1', upload(JPEG, { mimetype: 'image/png' }), 'user_1', '10.0.0.1');

    expect(audit.write).toHaveBeenCalledWith(
      'user_1',
      'pharmacy.logo.upload',
      'Pharmacy',
      'ph_1',
      expect.objectContaining({ mimeType: 'image/jpeg', declaredMimeType: 'image/png' }),
      '10.0.0.1',
    );
  });

  it('returns the stored bytes and type for the download route', async () => {
    const updatedAt = new Date('2026-08-18T10:00:00.000Z');
    prisma.pharmacyLogo.findUnique.mockResolvedValue({
      data: PNG,
      mimeType: 'image/png',
      updatedAt,
    });

    await expect(service.find('ph_1')).resolves.toEqual({
      data: PNG,
      mimeType: 'image/png',
      updatedAt,
    });
  });

  it('reports no logo rather than an empty one', async () => {
    prisma.pharmacyLogo.findUnique.mockResolvedValue(null);

    await expect(service.find('ph_1')).resolves.toBeNull();
  });
});

describe('logoUrlFor', () => {
  it('is null when there is no logo, so a client renders its own placeholder', () => {
    expect(logoUrlFor('ph_1', null)).toBeNull();
    expect(logoUrlFor('ph_1', undefined)).toBeNull();
  });

  it('carries the timestamp, so a replaced logo is a different URL', () => {
    const at = new Date('2026-08-18T10:00:00.000Z');
    const later = new Date('2026-08-18T11:00:00.000Z');

    expect(logoUrlFor('ph_1', at)).toBe(`/pharmacies/ph_1/logo?v=${at.getTime()}`);
    expect(logoUrlFor('ph_1', at)).not.toBe(logoUrlFor('ph_1', later));
  });

  it('stays relative to the API base, which is reached through more than one origin', () => {
    expect(logoUrlFor('ph_1', new Date())).toMatch(/^\/pharmacies\//);
  });
});

describe('withLogoUrl', () => {
  it('swaps the timestamp for a URL and does not pass the raw column on', () => {
    const at = new Date('2026-08-18T10:00:00.000Z');

    const result = withLogoUrl({ id: 'ph_1', name: 'Apollo', logoUpdatedAt: at });

    expect(result).toEqual({
      id: 'ph_1',
      name: 'Apollo',
      logoUrl: `/pharmacies/ph_1/logo?v=${at.getTime()}`,
    });
    expect(result).not.toHaveProperty('logoUpdatedAt');
  });
});
