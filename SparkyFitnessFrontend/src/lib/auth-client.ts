import { createAuthClient } from 'better-auth/react';
import {
  magicLinkClient,
  twoFactorClient,
  adminClient,
  emailOTPClient,
} from 'better-auth/client/plugins';
import { apiKeyClient } from '@better-auth/api-key/client';
import { ssoClient } from '@better-auth/sso/client';
import { passkeyClient } from '@better-auth/passkey/client';

export const authClient = createAuthClient({
  // Use /api/auth as the base URL.
  baseURL: window.location.origin + '/api/auth',
  // Every plugin must keep its own inferred type. Widening any one of them to
  // the bare `BetterAuthClientPlugin` interface (`adminClient() as unknown as
  // BetterAuthClientPlugin` used to sit here) erases that plugin's actions, and
  // since 1.7 that collapses the whole inferred client to an index signature --
  // every `authClient.x` then fails `noPropertyAccessFromIndexSignature` and
  // `useSession()` data degrades to `never`. Do not re-add a cast here.
  plugins: [
    magicLinkClient(),
    adminClient(),
    twoFactorClient(),
    emailOTPClient(),
    ssoClient(),
    passkeyClient(),
    apiKeyClient(),
  ],
  // Completely disable session polling to prevent automatic refreshes on tab focus
  fetchOptions: {
    onError: async (error) => {
      console.error('[Auth Client] Error:', error);
    },
  },
});
