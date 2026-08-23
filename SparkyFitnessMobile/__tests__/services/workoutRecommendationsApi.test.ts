import {
  fetchRecommendation,
  generateRecommendation,
  patchRecommendationStatus,
} from '../../src/services/api/workoutRecommendationsApi';
import { getActiveServerConfig, ServerConfig } from '../../src/services/storage';

jest.mock('../../src/services/storage', () => ({
  getActiveServerConfig: jest.fn(),
  proxyHeadersToRecord: jest.requireActual('../../src/services/storage').proxyHeadersToRecord,
}));

jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(),
}));

const mockGetActiveServerConfig = getActiveServerConfig as jest.MockedFunction<
  typeof getActiveServerConfig
>;

const testConfig: ServerConfig = {
  id: 'test-id',
  url: 'https://example.com',
  apiKey: 'test-api-key-12345',
};

describe('workoutRecommendationsApi', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = mockFetch;
    mockGetActiveServerConfig.mockResolvedValue(testConfig);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetchRecommendation', () => {
    it('returns the stored recommendation', async () => {
      const row = { id: 'rec-1', status: 'active' };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(row) });

      await expect(fetchRecommendation()).resolves.toEqual(row);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/workout-recommendations',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('resolves to null on 404 — a user who has never generated one', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('No workout recommendation yet.'),
        headers: { get: () => null },
      });

      await expect(fetchRecommendation()).resolves.toBeNull();
    });

    it('still throws on any other failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('boom'),
        headers: { get: () => null },
      });

      await expect(fetchRecommendation()).rejects.toThrow('Server error: 500');
    });
  });

  it('posts the generate request body', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'rec-1' }) });

    await generateRecommendation({ swap: true, duration_minutes: 45 });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/workout-recommendations/generate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ swap: true, duration_minutes: 45 }),
      }),
    );
  });

  it('sends an empty body when generate is called with no options', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'rec-1' }) });

    await generateRecommendation();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/workout-recommendations/generate',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('PATCHes the status — the route accepts nothing else', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'rec-1' }) });

    await patchRecommendationStatus('rec-1', 'started');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/workout-recommendations/rec-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'started' }),
      }),
    );
  });
});
