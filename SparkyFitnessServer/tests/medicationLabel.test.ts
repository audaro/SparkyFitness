import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error supertest has no bundled types in this project
import request from 'supertest';
import express from 'express';
import axios from 'axios';
import preferenceRepository from '../models/preferenceRepository.js';
import medicationRepository from '../models/medicationRepository.js';
import { log } from '../config/logging.js';
import { __clearOpenFdaCacheForTests } from '../integrations/openfda/OpenFdaService.js';
import medicationRoutes from '../routes/v2/medicationRoutes.js';
import { OPENFDA_FIXTURES } from './fixtures/openFdaResponses.js';

/**
 * `GET /api/v2/medications/:id/label`, end to end from the route through the consent gate and
 * the cache down to the wire.
 *
 * Only axios, the preference read and the medication read are mocked, so these exercise the real
 * route wiring, the real gate and the real parser together — the arrangement
 * `medicationCatalogSearch.test.ts` uses, for the same reason.
 *
 * Three assertions here matter more than the rest, and each defends a decision this feature was
 * blocked on:
 *
 *   - an owner who has not opted in causes **no outbound request at all**, because reusing the
 *     catalog preference is only defensible if it is genuinely enforced;
 *   - the RxCUI **never reaches the log**, for the reason the RxTerms proxy documents;
 *   - a 404 is an **answer**, not an outage, because openFDA reports "no matches" that way and
 *     an unlisted drug is the ordinary case.
 */

vi.mock('axios');
vi.mock('../models/preferenceRepository.js');
vi.mock('../models/medicationRepository.js');
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(async () => ({
    query: vi.fn(async () => ({ rows: [{ is_supplement: false }] })),
    release: vi.fn(),
  })),
}));
vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default: vi.fn(
    () =>
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) =>
        next()
  ),
}));
vi.mock('../middleware/onBehalfOfMiddleware.js', () => ({
  default: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(async () => 'America/New_York'),
  resolveTemplateStartDay: vi.fn(async () => '2026-07-28'),
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const match = req.headers.cookie?.match(/userId=([^;]+)/);
  if (match) req.userId = match[1];
  next();
});
app.use('/api/v2/medications', medicationRoutes);

const MEDICATION_ID = '11111111-2222-4333-8444-555555555555';
const cookie = ['userId=testUser'];
const label = (id: string = MEDICATION_ID) =>
  request(app).get(`/api/v2/medications/${id}/label`).set('Cookie', cookie);

const mockedAxios = vi.mocked(axios, true);
const mockedPreferences = vi.mocked(preferenceRepository, true);
const mockedMedications = vi.mocked(medicationRepository, true);
const mockedLog = vi.mocked(log);

function optIn(enabled = true) {
  mockedPreferences.getUserPreferences.mockResolvedValue({
    medication_catalog_lookup_enabled: enabled,
  } as any);
}

/** A saved medication row, carrying an RxCUI unless a test says otherwise. */
function medicationHasRxcui(rxcui: string | null = '2601723') {
  mockedMedications.getMedicationById.mockResolvedValue({
    id: MEDICATION_ID,
    name: 'Mounjaro',
    rxnorm_rxcui: rxcui,
  } as any);
}

function upstreamReturns(status: number, data: unknown) {
  (mockedAxios.get as any).mockResolvedValue({ status, data });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The cache is process-wide, so a test that primed it would otherwise decide whether the next
  // one makes a request.
  __clearOpenFdaCacheForTests();
});

describe('GET /api/v2/medications/:id/label', () => {
  it('is reachable rather than being read as a medication id', async () => {
    // '/:id' is registered on the same router. This route has two segments, so it cannot be
    // shadowed — but the catalog-search route next door proves the failure is easy to create.
    optIn();
    medicationHasRxcui();
    upstreamReturns(200, OPENFDA_FIXTURES.tirzepatide);

    await label().expect(200);
  });

  it('returns the provenance the panel renders', async () => {
    optIn();
    medicationHasRxcui();
    upstreamReturns(200, OPENFDA_FIXTURES.tirzepatide);

    const res = await label().expect(200);

    expect(res.body.unavailableReason).toBeNull();
    expect(res.body.totalMatches).toBe(31);
    expect(res.body.products[0]).toMatchObject({
      productNdc: '0002-1434',
      labelerName: 'Eli Lilly and Company',
      brandName: 'Mounjaro',
    });
  });

  it('sends only the RxCUI, and sends it as an exact-match query', async () => {
    optIn();
    medicationHasRxcui();
    upstreamReturns(200, OPENFDA_FIXTURES.tirzepatide);

    await label().expect(200);

    const [url, config] = (mockedAxios.get as any).mock.calls[0];
    expect(url).toBe('https://api.fda.gov/drug/ndc.json');
    expect(config.params.search).toBe('openfda.rxcui:"2601723"');
    // The medication's name is on the row this route just read. It must not be in the request.
    expect(JSON.stringify(config)).not.toContain('Mounjaro');
  });

  it('rejects a medication id that is not a uuid', async () => {
    await label('not-a-uuid').expect(400);

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  describe('the consent gate', () => {
    it('makes no request at all when the owner has not opted in', async () => {
      optIn(false);
      medicationHasRxcui();

      const res = await label().expect(200);

      expect(res.body).toEqual({
        products: [],
        totalMatches: 0,
        unavailableReason: 'lookup_disabled',
      });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('treats no recorded answer as no', async () => {
      // A user row that predates the migration has no answer. "No answer" to a question about a
      // third-party request is not consent.
      mockedPreferences.getUserPreferences.mockResolvedValue(null);
      medicationHasRxcui();

      const res = await label().expect(200);

      expect(res.body.unavailableReason).toBe('lookup_disabled');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("reads the record owner's preference, not the caller's", async () => {
      optIn();
      medicationHasRxcui();
      upstreamReturns(200, OPENFDA_FIXTURES.tirzepatide);

      await label().expect(200);

      expect(mockedPreferences.getUserPreferences).toHaveBeenCalledWith(
        'testUser'
      );
      expect(mockedMedications.getMedicationById).toHaveBeenCalledWith(
        'testUser',
        MEDICATION_ID
      );
    });
  });

  describe('a medication with nothing to look up', () => {
    it('answers no_rxcui without consulting the preference or the FDA', async () => {
      // Access is settled before consent is, so a caller cannot learn from the response whether
      // some other user's medication happens to have an RxCUI.
      optIn();
      medicationHasRxcui(null);

      const res = await label().expect(200);

      expect(res.body.unavailableReason).toBe('no_rxcui');
      expect(mockedPreferences.getUserPreferences).not.toHaveBeenCalled();
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('treats a blank RxCUI as no RxCUI', async () => {
      optIn();
      medicationHasRxcui('   ');

      const res = await label().expect(200);

      expect(res.body.unavailableReason).toBe('no_rxcui');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("answers no_rxcui for a medication that is not the caller's", async () => {
      // RLS scopes the read, so another user's row simply is not there.
      optIn();
      mockedMedications.getMedicationById.mockResolvedValue(null);

      const res = await label().expect(200);

      expect(res.body.unavailableReason).toBe('no_rxcui');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('never lets a malformed RxCUI reach the query it would be interpolated into', async () => {
      optIn();
      medicationHasRxcui('2601723" OR labeler_name:"Pfizer');

      const res = await label().expect(200);

      expect(res.body.unavailableReason).toBe('not_found');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('what the FDA answers', () => {
    it('reads a 404 as "not listed", not as an outage', async () => {
      // openFDA reports "no matches" with a 404 body. Treating a non-200 as a failure would
      // report every older or foreign product as an unreachable FDA.
      upstreamReturns(404, OPENFDA_FIXTURES.notFound);
      optIn();
      medicationHasRxcui();

      const res = await label().expect(200);

      expect(res.body).toEqual({
        products: [],
        totalMatches: 0,
        unavailableReason: 'not_found',
      });
    });

    it('distinguishes an unreachable FDA from an unlisted drug', async () => {
      (mockedAxios.get as any).mockRejectedValue(
        Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
      );
      optIn();
      medicationHasRxcui();

      const res = await label().expect(200);

      expect(res.body.unavailableReason).toBe('lookup_failed');
    });

    it('reports a rate-limited or erroring upstream as lookup_failed', async () => {
      upstreamReturns(429, { error: { code: 'OVER_RATE_LIMIT' } });
      optIn();
      medicationHasRxcui();

      const res = await label().expect(200);

      expect(res.body.unavailableReason).toBe('lookup_failed');
    });

    it('never becomes an error the user has to dismiss', async () => {
      (mockedAxios.get as any).mockRejectedValue(new Error('boom'));
      optIn();
      medicationHasRxcui();

      await label().expect(200);
    });
  });

  describe('the log', () => {
    it('names the failure without naming the drug', async () => {
      // An axios error carries `config.params`, which here is the RxCUI. Logging the error
      // object would put a pointer to what this server's user takes into a log file.
      (mockedAxios.get as any).mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
          config: { params: { search: 'openfda.rxcui:"2601723"' } },
        })
      );
      optIn();
      medicationHasRxcui();

      await label().expect(200);

      expect(mockedLog).toHaveBeenCalled();
      const logged = JSON.stringify(mockedLog.mock.calls);
      expect(logged).not.toContain('2601723');
      expect(logged).not.toContain('Mounjaro');
      expect(logged).toContain('ECONNREFUSED');
    });
  });

  describe('the cache', () => {
    it('asks the FDA once per RxCUI', async () => {
      optIn();
      medicationHasRxcui();
      upstreamReturns(200, OPENFDA_FIXTURES.tirzepatide);

      await label().expect(200);
      const second = await label().expect(200);

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(second.body.products).toHaveLength(2);
      expect(second.body.totalMatches).toBe(31);
    });

    it('caches a 404, because an unlisted drug will not become listed within the day', async () => {
      upstreamReturns(404, OPENFDA_FIXTURES.notFound);
      optIn();
      medicationHasRxcui();

      await label().expect(200);
      const second = await label().expect(200);

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(second.body.unavailableReason).toBe('not_found');
    });

    it('does not cache a failure, so a blip cannot freeze a drug as unlisted', async () => {
      optIn();
      medicationHasRxcui();
      (mockedAxios.get as any).mockRejectedValueOnce(new Error('blip'));

      const first = await label().expect(200);
      expect(first.body.unavailableReason).toBe('lookup_failed');

      upstreamReturns(200, OPENFDA_FIXTURES.tirzepatide);
      const second = await label().expect(200);

      expect(second.body.unavailableReason).toBeNull();
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });
});
