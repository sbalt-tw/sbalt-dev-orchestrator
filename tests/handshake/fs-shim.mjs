/* global process */
// Test-only. Stands in for `node:fs` inside the CLI child, so that the publication window can be
// entered deterministically instead of being raced.
//
// Everything is forwarded to the real module untouched except `linkSync`, which is where the
// publication happens. After the real link succeeds and BEFORE returning to production code — so
// the caller is provably between publication and its cleanup — it announces readiness and waits
// for the parent to release it.
//
// Round 18 rewrote the waiting. The previous version spun on `Date.now()` until a deadline and
// then simply returned, which meant a stalled parent could arrive after the hold had quietly
// expired and after cleanup had finished, and still be recorded as having signalled inside the
// window. Three things changed:
//
//   * the deadline is monotonic (`process.hrtime.bigint`), so moving the wall clock in either
//     direction cannot lengthen, shorten or end the hold;
//   * expiry is never silent. It writes an `expired` marker and leaves no `released` marker, and
//     the parent fails on that evidence;
//   * releasing writes a `released` marker BEFORE `linkSync` returns. That marker — not the mere
//     existence of `ready` — is the child's own proof that it observed the release while still
//     holding the publication open.
//
// Deliberately no exception on expiry: production wraps this call and would catch it, clean up
// and report an ordinary failure, which the test could easily mistake for a normal refusal. The
// markers let the test side decide for itself, independently of anything production reports.
import { createRequire } from 'node:module';

const real = createRequire(import.meta.url)('fs');

const READY = process.env.A1_HANDSHAKE_READY;
const RELEASE = process.env.A1_HANDSHAKE_RELEASE;
const RELEASED = process.env.A1_HANDSHAKE_RELEASED;
const EXPIRED = process.env.A1_HANDSHAKE_EXPIRED;
const LIMIT_MS = Number(process.env.A1_HANDSHAKE_LIMIT_MS ?? '15000');

const armed = [READY, RELEASE, RELEASED, EXPIRED].every((v) => v !== undefined && v !== '');

// Lets a test move this child's wall clock, to demonstrate that the hold's deadline does not
// depend on it. Applied here because the shim is loaded before production code runs.
const SKEW_MS = Number(process.env.A1_HANDSHAKE_SKEW_MS ?? '0');
if (SKEW_MS !== 0) {
  const realNow = Date.now;
  Date.now = () => realNow() + SKEW_MS;
}

export const linkSync = (from, to) => {
  const result = real.linkSync(from, to);
  if (!armed) return result;

  real.writeFileSync(READY, 'linked');

  const limitNs = BigInt(Math.max(0, Math.trunc(LIMIT_MS))) * 1_000_000n;
  const startedAt = process.hrtime.bigint();
  for (;;) {
    if (real.existsSync(RELEASE)) {
      // Written while still inside linkSync, before returning to production.
      real.writeFileSync(RELEASED, 'observed-before-return');
      return result;
    }
    if (process.hrtime.bigint() - startedAt >= limitNs) {
      real.writeFileSync(EXPIRED, 'hold-expired-without-release');
      return result;
    }
  }
};

export const closeSync = real.closeSync;
export const existsSync = real.existsSync;
export const fsyncSync = real.fsyncSync;
export const lstatSync = real.lstatSync;
export const openSync = real.openSync;
export const readSync = real.readSync;
export const realpathSync = real.realpathSync;
export const rmSync = real.rmSync;
export const statSync = real.statSync;
export const writeFileSync = real.writeFileSync;
export default real;
