import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzePhoto,
  comparePhotos,
  isVisionConfigured,
  visionHealth,
  VisionServiceError,
  type VisionImage,
} from '../integrations/vision/visionService.js';

/**
 * A stand-in sidecar.
 *
 * A real socket rather than a mocked axios: the part of this client most
 * likely to be quietly wrong is the multipart encoding, and only an actual
 * request body proves the field names the Python side reads by name are the
 * ones being sent.
 */
let lastBody = '';
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let baseUrl: string;

const image = (name: string): VisionImage => ({
  bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  filename: name,
  contentType: 'image/jpeg',
});

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      lastBody = Buffer.concat(chunks).toString('latin1');
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  delete process.env.VISION_MICROSERVICE_URL;
});

const configured = () => {
  process.env.VISION_MICROSERVICE_URL = `${baseUrl}/`;
};

describe('visionService configuration', () => {
  it('treats an unset url as the feature being absent', () => {
    // No localhost default: a silent connection refused on every photo view is
    // worse than a feature that openly reports itself as unconfigured.
    expect(isVisionConfigured()).toBe(false);
  });

  it('refuses to call anything when it has no url', async () => {
    await expect(analyzePhoto(image('a.jpg'))).rejects.toMatchObject({
      reason: 'vision_not_configured',
      isPhotoProblem: false,
    });
  });

  it('reports an unconfigured service without pretending it is broken', async () => {
    expect(await visionHealth()).toEqual({
      configured: false,
      ok: false,
      engine: null,
    });
  });
});

describe('visionService requests', () => {
  it('sends both photos under the field names the sidecar reads', async () => {
    configured();
    let seenUrl = '';
    handler = (req, res) => {
      seenUrl = req.url ?? '';
      json(res, 200, { engine: 'e', before: {}, after: {} });
    };

    await comparePhotos(image('before.jpg'), image('after.jpg'), true);

    expect(lastBody).toContain('name="before"');
    expect(lastBody).toContain('name="after"');
    expect(lastBody).toContain('filename="before.jpg"');
    expect(seenUrl).toBe('/compare?include_aligned=true');
  });

  it('does not double the slash when the url has a trailing one', async () => {
    configured();
    let seenUrl = '';
    handler = (req, res) => {
      seenUrl = req.url ?? '';
      json(res, 200, { engine: 'e' });
    };

    await analyzePhoto(image('a.jpg'));

    expect(seenUrl).toBe('/analyze');
  });
});

describe('visionService failures', () => {
  it('carries the sidecar reason through a 4xx and blames the photo', async () => {
    configured();
    handler = (_req, res) =>
      json(res, 422, { detail: 'landmark_not_visible:ankles' });

    await expect(analyzePhoto(image('a.jpg'))).rejects.toMatchObject({
      reason: 'landmark_not_visible:ankles',
      isPhotoProblem: true,
    });
  });

  it('blames the service, not the photo, on a 500', async () => {
    // Telling someone their photo is unusable because the service fell over
    // would send them off to retake a perfectly good picture.
    configured();
    handler = (_req, res) => json(res, 500, { detail: 'boom' });

    const error = await analyzePhoto(image('a.jpg')).catch((e) => e);
    expect(error).toBeInstanceOf(VisionServiceError);
    expect(error.isPhotoProblem).toBe(false);
  });

  it('retries a 500 and succeeds when the service comes back', async () => {
    configured();
    let calls = 0;
    handler = (_req, res) => {
      calls += 1;
      if (calls < 2) {
        json(res, 503, { detail: 'starting' });
        return;
      }
      json(res, 200, { engine: 'e', metrics: {}, landmarks: [] });
    };

    const result = await analyzePhoto(image('a.jpg'));

    expect(calls).toBe(2);
    expect(result.engine).toBe('e');
  }, 10000);

  it('does not retry a photo the sidecar has already rejected', async () => {
    // The same photo will not grow a body on the second attempt; retrying only
    // spends inference on a known answer.
    configured();
    let calls = 0;
    handler = (_req, res) => {
      calls += 1;
      json(res, 422, { detail: 'pose_not_detected' });
    };

    await expect(analyzePhoto(image('a.jpg'))).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('reports a configured but unreachable service as such', async () => {
    configured();
    handler = (_req, res) => json(res, 500, {});

    expect(await visionHealth()).toEqual({
      configured: true,
      ok: false,
      engine: null,
    });
  });

  it('reports a healthy service with its engine', async () => {
    configured();
    handler = (_req, res) => json(res, 200, { status: 'ok', engine: 'mp-1' });

    expect(await visionHealth()).toEqual({
      configured: true,
      ok: true,
      engine: 'mp-1',
    });
  });
});
