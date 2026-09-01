import { vi, beforeEach, describe, expect, it } from 'vitest';
import axios from 'axios';
import { getSystemClient } from '../db/poolManager.js';
import { encrypt } from '../security/encryption.js';
import {
  exchangeCodeForTokens,
  getAuthorizationUrl,
} from '../integrations/withings/withingsService.js';

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
const OAUTH_STATE = 'issued-nonce';
const REDIRECT_URI = 'https://app.test/withings/callback';

const PROVIDER_ROW = {
  oauth_state: OAUTH_STATE,
  encrypted_app_id: 'a',
  app_id_iv: 'b',
  app_id_tag: 'c',
  encrypted_app_key: 'd',
  app_key_iv: 'e',
  app_key_tag: 'f',
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

describe('Withings OAuth state binding', () => {
  it('issues an unguessable nonce rather than the user id and stores it', async () => {
    const client = mockClient();

    const url = await getAuthorizationUrl(USER_ID);

    const state = new URL(url).searchParams.get('state');
    expect(state).not.toBeNull();
    expect(state).not.toBe(USER_ID);
    // 32 random bytes, hex-encoded.
    expect(state).toMatch(/^[0-9a-f]{64}$/);

    const update = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('SET oauth_state')
    );
    expect(update).toBeDefined();
    expect(update?.[1]).toEqual([state, USER_ID]);
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

  it('rejects a callback whose state does not match the issued nonce', async () => {
    const client = mockClient();

    await expect(
      exchangeCodeForTokens(USER_ID, 'code', 'forged-nonce', REDIRECT_URI)
    ).rejects.toThrow(/Invalid OAuth state/);

    // Rejected before the code was ever redeemed, so no token was minted.
    expect(axios.post).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects a callback with no state at all', async () => {
    mockClient();

    await expect(
      exchangeCodeForTokens(USER_ID, 'code', undefined, REDIRECT_URI)
    ).rejects.toThrow(/Invalid OAuth state/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback when no authorization was started for the user', async () => {
    mockClient({ ...PROVIDER_ROW, oauth_state: null });

    await expect(
      exchangeCodeForTokens(USER_ID, 'code', OAUTH_STATE, REDIRECT_URI)
    ).rejects.toThrow(/Invalid OAuth state/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('clears the nonce once the exchange succeeds so it cannot be replayed', async () => {
    const client = mockClient();
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        status: 0,
        body: {
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 10800,
          userid: 42,
        },
      },
    });

    await exchangeCodeForTokens(USER_ID, 'code', OAUTH_STATE, REDIRECT_URI);

    const update = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('encrypted_access_token =')
    );
    expect(update).toBeDefined();
    expect(String(update?.[0])).toContain('oauth_state = NULL');
  });
});
