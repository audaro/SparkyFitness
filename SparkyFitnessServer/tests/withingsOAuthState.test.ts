import { vi, beforeEach, describe, expect, it } from 'vitest';
import { getSystemClient } from '../db/poolManager.js';
import { encrypt } from '../security/encryption.js';
import { getAuthorizationUrl } from '../integrations/withings/withingsService.js';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../utils/diagnosticLogger.js', () => ({ logRawResponse: vi.fn() }));
vi.mock('../integrations/withings/withingsDataProcessor.js', () => ({
  default: {},
}));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));
vi.mock('../security/encryption.js', () => ({
  ENCRYPTION_KEY: 'test-key',
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

const USER_ID = 'user-1';

const PROVIDER_ROW = {
  id: 'provider-row-1',
  encrypted_app_id: 'a',
  app_id_iv: 'b',
  app_id_tag: 'c',
};

function mockClient(row: Record<string, unknown> = PROVIDER_ROW) {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 }),
    release: vi.fn(),
  };
  vi.mocked(getSystemClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof getSystemClient>>
  );
  return client;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { decrypt } = await import('../security/encryption.js');
  vi.mocked(decrypt).mockResolvedValue('decrypted-value');
  vi.mocked(encrypt).mockResolvedValue({
    encryptedText: 'enc',
    iv: 'iv',
    tag: 'tag',
  });
});

// Claiming a state — forged, replayed, expired or cross-user — lives in
// `utils/oauthState.ts` and is covered by `oauthState.test.ts`. What is
// Withings-specific, and covered here, is that the authorize URL hands the
// provider the nonce that was actually persisted for this user.
describe('Withings OAuth state issuance', () => {
  it('issues an unguessable nonce rather than the user id and stores it', async () => {
    const client = mockClient();

    const url = await getAuthorizationUrl(USER_ID);

    const state = new URL(url).searchParams.get('state');
    expect(state).not.toBeNull();
    expect(state).not.toBe(USER_ID);
    // 32 random bytes hex-encoded, joined to the issue timestamp.
    expect(state).toMatch(/^[0-9a-f]{64}\.\d+$/);

    const update = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('SET oauth_state')
    );
    expect(update).toBeDefined();
    expect(update?.[1]).toEqual([state, USER_ID, 'withings', null]);
  });

  it('issues a different nonce on every authorization', async () => {
    mockClient();
    const first = new URL(await getAuthorizationUrl(USER_ID)).searchParams.get(
      'state'
    );
    const second = new URL(await getAuthorizationUrl(USER_ID)).searchParams.get(
      'state'
    );
    expect(first).not.toBe(second);
  });
});
