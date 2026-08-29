import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScanController } from './scan.controller';
import { VisionService } from './vision.service';

/**
 * Assisted reading — the AI/Vision fallback behind on-device OCR.
 *
 * Two things are load-bearing here. It must be *off* and say so when the
 * deployment has no key, because the scan UI decides whether to offer the
 * fallback from that answer; and it must never let a configuration value —
 * least of all the key — reach a response body or a log line.
 */

const createMock = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class {
    messages = { create: (...args: unknown[]) => createMock(...args) };
  },
}));

const configWith = (env: Record<string, string>) =>
  ({
    get: (key: string, fallback = '') => env[key] ?? fallback,
  }) as unknown as ConfigService;

const KEY = 'sk-ant-not-a-real-key';

describe('VisionService.availability', () => {
  it('is unavailable, with a reason, when no key is configured', () => {
    const service = new VisionService(configWith({}));

    expect(service.availability()).toEqual({
      available: false,
      reason: expect.stringMatching(/not configured/i),
    });
    expect(service.isEnabled()).toBe(false);
  });

  it('is unavailable when switched off, even with a key', () => {
    const service = new VisionService(
      configWith({ ANTHROPIC_API_KEY: KEY, SCAN_VISION_ENABLED: 'false' }),
    );

    expect(service.availability()).toEqual({
      available: false,
      reason: expect.stringMatching(/switched off/i),
    });
  });

  it('is available when configured', () => {
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: KEY }));

    expect(service.availability()).toEqual({ available: true });
    expect(service.isEnabled()).toBe(true);
  });

  it('treats a whitespace-only key as no key', () => {
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: '   ' }));
    expect(service.isEnabled()).toBe(false);
  });

  it('never puts the key in the reason', () => {
    const service = new VisionService(
      configWith({ ANTHROPIC_API_KEY: KEY, SCAN_VISION_ENABLED: 'false' }),
    );

    expect(JSON.stringify(service.availability())).not.toContain(KEY);
  });
});

describe('VisionService.extractMedicines', () => {
  beforeEach(() => jest.clearAllMocks());

  const reply = (payload: unknown) => ({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  });

  it('refuses to run when the deployment is not configured', async () => {
    const service = new VisionService(configWith({}));

    await expect(service.extractMedicines(['data:image/jpeg;base64,AAAA'])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it('returns the medicines the model read', async () => {
    createMock.mockResolvedValue(
      reply({
        medicines: [
          {
            name: 'Amoxicillin',
            genericName: 'Amoxicillin',
            strength: '500 mg',
            form: 'capsule',
            frequency: 'TDS',
            duration: '5 days',
            confidence: 0.82,
          },
        ],
      }),
    );
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: KEY }));

    const medicines = await service.extractMedicines(['data:image/jpeg;base64,AAAA']);

    expect(medicines).toEqual([
      expect.objectContaining({ name: 'Amoxicillin', strength: '500 mg', confidence: 0.82 }),
    ]);
  });

  it('sends the configured model and the page images', async () => {
    createMock.mockResolvedValue(reply({ medicines: [] }));
    const service = new VisionService(
      configWith({ ANTHROPIC_API_KEY: KEY, SCAN_VISION_MODEL: 'claude-test-model' }),
    );

    await service.extractMedicines(['data:image/jpeg;base64,AAAA']);

    const [request] = createMock.mock.calls[0] as [Record<string, any>];
    expect(request.model).toBe('claude-test-model');
    expect(request.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg' },
    });
  });

  it('reports an empty list rather than failing when nothing is legible', async () => {
    // An empty result is a correct answer, not an error.
    createMock.mockResolvedValue(reply({ medicines: [] }));
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: KEY }));

    await expect(service.extractMedicines(['data:image/jpeg;base64,AAAA'])).resolves.toEqual([]);
  });

  it('drops entries with no usable name instead of passing them on', async () => {
    createMock.mockResolvedValue(
      reply({ medicines: [{ name: '', confidence: 0.9 }, { name: 'A', confidence: 0.9 }] }),
    );
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: KEY }));

    await expect(service.extractMedicines(['data:image/jpeg;base64,AAAA'])).resolves.toEqual([]);
  });

  it('clamps a confidence the model reported out of range', async () => {
    createMock.mockResolvedValue(
      reply({ medicines: [{ name: 'Metformin', confidence: 4.2 }] }),
    );
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: KEY }));

    const [medicine] = await service.extractMedicines(['data:image/jpeg;base64,AAAA']);
    expect(medicine.confidence).toBe(1);
  });

  it('survives output that is not the JSON it asked for', async () => {
    createMock.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'sorry' }] });
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: KEY }));

    await expect(service.extractMedicines(['data:image/jpeg;base64,AAAA'])).resolves.toEqual([]);
  });

  it('turns a refusal into a message the patient can act on', async () => {
    createMock.mockResolvedValue({ stop_reason: 'refusal', content: [] });
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: KEY }));

    await expect(service.extractMedicines(['data:image/jpeg;base64,AAAA'])).rejects.toThrow(
      /enter the medicine name manually/i,
    );
  });

  it('keeps prescription content out of the logs as well as the response', async () => {
    // A provider error quotes the offending request back, and the request here
    // is a prescription image.
    const logged: string[] = [];
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: KEY }));
    jest
      .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation((message: string) => {
        logged.push(String(message));
      });
    const upstream = Object.assign(new Error('400: image data "PATIENT NAME, Amoxicillin 500mg"'), {
      name: 'BadRequestError',
      status: 400,
    });
    createMock.mockRejectedValue(upstream);

    await expect(service.extractMedicines(['data:image/jpeg;base64,AAAA'])).rejects.toThrow();

    expect(logged.join(' ')).not.toContain('PATIENT NAME');
    expect(logged.join(' ')).not.toContain('Amoxicillin');
    // Still says enough to debug with.
    expect(logged.join(' ')).toContain('BadRequestError');
    expect(logged.join(' ')).toContain('400');
  });

  it('never leaks the upstream error to the client', async () => {
    // Provider errors can echo request content — a prescription, here.
    createMock.mockRejectedValue(new Error('400 invalid_request: image data "PATIENT NAME"'));
    const service = new VisionService(configWith({ ANTHROPIC_API_KEY: KEY }));

    await expect(service.extractMedicines(['data:image/jpeg;base64,AAAA'])).rejects.toThrow(
      /temporarily unavailable/i,
    );
    await expect(service.extractMedicines(['data:image/jpeg;base64,AAAA'])).rejects.not.toThrow(
      /PATIENT NAME/,
    );
  });
});

describe('ScanController', () => {
  it('reports availability, with the reason, from the service', () => {
    const controller = new ScanController(new VisionService(configWith({})));

    expect(controller.status()).toEqual({
      available: false,
      reason: expect.stringMatching(/not configured/i),
    });
  });

  it('reports availability with no reason when it is on offer', () => {
    const controller = new ScanController(
      new VisionService(configWith({ ANTHROPIC_API_KEY: KEY })),
    );

    expect(controller.status()).toEqual({ available: true });
  });

  it('hands the images to the service and returns what it read', async () => {
    const vision = { extractMedicines: jest.fn().mockResolvedValue([{ name: 'Dolo 650' }]) };
    const controller = new ScanController(vision as unknown as VisionService);

    const result = await controller.extract({ images: ['data:image/jpeg;base64,AAAA'] });

    expect(vision.extractMedicines).toHaveBeenCalledWith(['data:image/jpeg;base64,AAAA']);
    expect(result).toEqual({ medicines: [{ name: 'Dolo 650' }] });
  });
});
