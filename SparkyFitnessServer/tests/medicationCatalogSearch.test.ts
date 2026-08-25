import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error supertest has no bundled types in this project
import request from 'supertest';
import express from 'express';
import axios from 'axios';
import preferenceRepository from '../models/preferenceRepository.js';
import { log } from '../config/logging.js';
import {
  clearRxTermsCache,
  searchRxTerms,
} from '../integrations/rxterms/RxTermsService.js';
import medicationRoutes from '../routes/v2/medicationRoutes.js';
import { RXTERMS_FIXTURES } from './fixtures/rxtermsResponses.js';

/**
 * Tier 3 of the medication search, end to end from the route down to the wire.
 *
 * Only axios and the preference read are mocked, so these exercise the real route wiring, the
 * real opt-in gate and the real parser together. The two assertions worth keeping above all
 * others are that an opted-out user causes no outbound request at all, and that the medication
 * name never reaches the log — both are the whole reason this endpoint is a server-side proxy
 * rather than a fetch from the browser.
 */

vi.mock('axios');
vi.mock('../models/preferenceRepository.js');
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

const cookie = ['userId=testUser'];
const search = (query: string) =>
  request(app)
    .get(`/api/v2/medications/catalog-search${query}`)
    .set('Cookie', cookie);

const mockedAxios = vi.mocked(axios, true);
const mockedPreferences = vi.mocked(preferenceRepository, true);

/** The opted-in state, which most tests want. */
function optIn(enabled = true) {
  mockedPreferences.getUserPreferences.mockResolvedValue({
    medication_catalog_lookup_enabled: enabled,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function upstreamReturns(status: number, data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockedAxios.get as any).mockResolvedValue({ status, data });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The cache lives for the module's lifetime, so a test that primed it would otherwise decide
  // whether the next one makes a request.
  clearRxTermsCache();
});

describe('GET /api/v2/medications/catalog-search', () => {
  it('is reachable, rather than being read as a medication id', () => {
    // '/:id' is registered on the same router. If this route were declared after it, Express
    // would match "catalog-search" as an id and this would 400 or 404 forever.
    optIn();
    upstreamReturns(200, RXTERMS_FIXTURES.testosterone);
    return search('?q=testosterone').expect(200);
  });

  it('returns the products the tier exists to ship', async () => {
    optIn();
    upstreamReturns(200, RXTERMS_FIXTURES.testosterone);

    const res = await search('?q=testosterone').expect(200);

    expect(res.body.unavailableReason).toBeNull();
    expect(res.body.products[0]).toMatchObject({
      displayName: 'Testosterone (Injectable)',
      baseName: 'Testosterone',
    });
    expect(res.body.products[0].strengths).toContainEqual(
      expect.objectContaining({
        raw: '200 mg/ml Injection 1 ml',
        value: 200,
        unit: 'mg/ml',
        rxcui: '2047882',
      })
    );
  });

  it('omits products the bundled catalog already describes', async () => {
    optIn();
    upstreamReturns(200, RXTERMS_FIXTURES.semaglutide);

    const res = await search('?q=semaglutide').expect(200);

    // Both semaglutide rows are suppressed, so this comes back empty rather than offering a
    // pen concentration beside the catalog's label ladder.
    expect(res.body.products).toEqual([]);
    expect(res.body.unavailableReason).toBeNull();
  });

  describe('the opt-in', () => {
    it('makes no outbound request at all when the user has not opted in', async () => {
      optIn(false);

      const res = await search('?q=testosterone').expect(200);

      expect(res.body).toEqual({
        products: [],
        unavailableReason: 'lookup_disabled',
      });
      // The assertion that matters. A response that merely discards the results would still
      // have sent the medication name to NLM.
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('treats a user with no preferences row as not opted in', async () => {
      mockedPreferences.getUserPreferences.mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any
      );

      const res = await search('?q=testosterone').expect(200);

      expect(res.body.unavailableReason).toBe('lookup_disabled');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('treats a null preference as not opted in', async () => {
      // A row written before the migration, read back before a default was applied. "No answer
      // recorded" about sending health data to a third party has to read as no.
      mockedPreferences.getUserPreferences.mockResolvedValue({
        medication_catalog_lookup_enabled: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const res = await search('?q=testosterone').expect(200);

      expect(res.body.unavailableReason).toBe('lookup_disabled');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('never blocks the form', () => {
    it('answers 200 with a reason when the upstream errors', async () => {
      optIn();
      upstreamReturns(503, 'Service Unavailable');

      const res = await search('?q=testosterone').expect(200);

      expect(res.body).toEqual({
        products: [],
        unavailableReason: 'upstream_unavailable',
      });
    });

    it('answers 200 with a reason when the request never completes', async () => {
      optIn();
      const timeout = Object.assign(new Error('timeout of 3000ms exceeded'), {
        code: 'ECONNABORTED',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockedAxios.get as any).mockRejectedValue(timeout);

      const res = await search('?q=testosterone').expect(200);

      expect(res.body.unavailableReason).toBe('upstream_unavailable');
    });

    it('answers 200 with a reason when the envelope is not what NLM used to send', async () => {
      optIn();
      // The quiet failure this guards: a changed shape parses as "no strengths" and tier 3
      // silently becomes a list of names with no doses.
      upstreamReturns(200, { results: [] });

      const res = await search('?q=testosterone').expect(200);

      expect(res.body.unavailableReason).toBe('upstream_unavailable');
    });
  });

  describe('never logs the query', () => {
    it('keeps the medication name out of the log when the request fails', async () => {
      optIn();
      // An axios error carries config.url and config.params, so logging the error object — the
      // reflex — would write the drug name straight into the server log.
      const failure = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
        config: {
          url: 'https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search',
          params: { terms: 'oxycodone' },
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockedAxios.get as any).mockRejectedValue(failure);

      await search('?q=oxycodone').expect(200);

      expect(vi.mocked(log)).toHaveBeenCalled();
      const everythingLogged = JSON.stringify(vi.mocked(log).mock.calls);
      expect(everythingLogged).not.toContain('oxycodone');
      // The failure mode is still named, so the log stays useful.
      expect(everythingLogged).toContain('ECONNREFUSED');
    });

    it('keeps the medication name out of the log when the upstream returns an error status', async () => {
      optIn();
      upstreamReturns(500, 'nope');

      await search('?q=oxycodone').expect(200);

      const everythingLogged = JSON.stringify(vi.mocked(log).mock.calls);
      expect(everythingLogged).not.toContain('oxycodone');
      expect(everythingLogged).toContain('500');
    });
  });

  describe('validation', () => {
    it('rejects a missing term', async () => {
      optIn();
      await search('').expect(400);
    });

    it('rejects an empty term', async () => {
      optIn();
      await search('?q=').expect(400);
      await search('?q=%20%20').expect(400);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('rejects an absurdly long term rather than forwarding it', async () => {
      optIn();
      await search(`?q=${'a'.repeat(101)}`).expect(400);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('rejects a limit outside the supported range', async () => {
      optIn();
      await search('?q=testosterone&limit=0').expect(400);
      await search('?q=testosterone&limit=99').expect(400);
    });

    it('does not spend a request on a term too short to be worth one', async () => {
      optIn();

      const res = await search('?q=te').expect(200);

      expect(res.body.unavailableReason).toBe('term_too_short');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('asks the upstream once for a repeated search', async () => {
      optIn();
      upstreamReturns(200, RXTERMS_FIXTURES.testosterone);

      await search('?q=testosterone').expect(200);
      await search('?q=Testosterone').expect(200);
      const res = await search('?q=  testosterone  ').expect(200);

      // Same term, differing only in case and padding — one request.
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(res.body.products.length).toBeGreaterThan(0);
    });

    it('caches a genuine no-result answer rather than re-asking every keystroke', async () => {
      optIn();
      upstreamReturns(200, RXTERMS_FIXTURES.retatrutide);

      await search('?q=retatrutide').expect(200);
      const res = await search('?q=retatrutide').expect(200);

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(res.body).toEqual({ products: [], unavailableReason: null });
    });

    it('keeps answering after the cache fills up', async () => {
      // NodeCache's maxKeys THROWS on insert once the bound is reached — it does not evict. That
      // throw lands in the request's own catch, so before `rememberProducts` isolated it, the
      // 5001st distinct search reported a perfectly good response as an unreachable upstream,
      // and every search after it did the same until the process restarted.
      optIn();
      upstreamReturns(200, RXTERMS_FIXTURES.testosterone);

      for (let i = 0; i <= 5000; i++) {
        const result = await searchRxTerms(`filler-drug-${i}`);
        expect(result.unavailableReason).toBeNull();
      }

      const res = await search('?q=testosterone').expect(200);
      expect(res.body.unavailableReason).toBeNull();
      expect(res.body.products.length).toBeGreaterThan(0);
    });

    it('does not cache a failure as though it were an answer', async () => {
      optIn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockedAxios.get as any).mockRejectedValueOnce(new Error('boom'));
      await search('?q=testosterone').expect(200);

      upstreamReturns(200, RXTERMS_FIXTURES.testosterone);
      const res = await search('?q=testosterone').expect(200);

      // A transient outage must not leave the user with an empty catalog for a day.
      expect(res.body.products.length).toBeGreaterThan(0);
    });
  });

  it('sends NLM the fields the parser needs and nothing about the user', async () => {
    optIn();
    upstreamReturns(200, RXTERMS_FIXTURES.testosterone);

    await search('?q=testosterone&limit=5').expect(200);

    const [, config] = vi.mocked(mockedAxios.get).mock.calls[0];
    expect(config?.params).toEqual({
      terms: 'testosterone',
      ef: 'STRENGTHS_AND_FORMS,RXCUIS',
      // Asked for more than the caller wants, since catalog-covered rows get dropped.
      maxList: 9,
    });
    // No identifier of any kind rides along.
    expect(JSON.stringify(config)).not.toContain('testUser');
  });
});
