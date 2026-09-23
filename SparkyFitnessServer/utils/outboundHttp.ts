import net from 'net';
import axios from 'axios';
import { log } from '../config/logging.js';

/**
 * Node's Happy Eyeballs implementation (`autoSelectFamily`, on by default since
 * Node 20) gives the first address to connect only 250ms before it starts
 * racing the next one. On a link where the handshake to a distant provider
 * legitimately takes longer than that, the competing attempt is started while
 * the first is still in flight and both then fail with ETIMEDOUT, so a
 * reachable host looks completely unreachable.
 *
 * Issues #2285 / #2399 are this: a Withings OAuth exchange that hung for
 * minutes, on a host where `curl -v4` to the same endpoint succeeded. The
 * reporter measured the real cost with `net.setDefaultAutoSelectFamily(false)`,
 * which connects sequentially like curl -- it returned OK in 2052ms. So the
 * connection needs ~2s and Node was abandoning it at 250ms. 5000ms was the
 * value confirmed working on that network.
 *
 * Which providers are exposed is dictated by DNS rather than by the
 * integration code: Withings, Fitbit and Strava publish AAAA records, while
 * IPv4-only providers such as Oura and Hevy never hit this. The fix is global
 * because the cause is.
 *
 * Sizing: this is not "how long to wait for the provider" -- it is how long a
 * single address gets before a second one is raced. Measured on Node 24, time
 * to connect equals this value exactly when the first address is unreachable,
 * and costs nothing when it is reachable. So it must clear the slowest
 * legitimate handshake (~2s here, hence real headroom) while staying small
 * against the 30s request ceiling below. 30s here would be actively wrong: it
 * would consume the entire request budget before a fallback was ever tried.
 *
 * This is the in-process equivalent of running Node with
 * `--network-family-autoselection-attempt-timeout`, so self-hosters do not have
 * to discover and set `NODE_OPTIONS` themselves.
 */
const CONNECT_ATTEMPT_TIMEOUT_MS = 5000;

/**
 * axios ships with no default timeout, so a blackholed connection sat open
 * until the operating system gave up -- the several-minute hang in #2285.
 * Callers that legitimately need longer (the Garmin microservice, dataset
 * downloads) set their own timeout, which still wins over this default.
 */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Applies the process-wide outbound HTTP defaults. Must run after the
 * environment is loaded and before any outbound request is made.
 */
function configureOutboundHttp(): void {
  // Applies to every consumer of net.connect that does not override it --
  // axios through the core http agents, and native fetch through undici.
  net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
  axios.defaults.timeout = REQUEST_TIMEOUT_MS;

  log(
    'info',
    `Outbound HTTP defaults: ${REQUEST_TIMEOUT_MS}ms request timeout, ${CONNECT_ATTEMPT_TIMEOUT_MS}ms per address-family connect attempt.`
  );
}

export { configureOutboundHttp };
