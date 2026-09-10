/* global process */
// Test-only. Stands in for `node:fs` inside the CLI child, so that the publication window can be
// entered deterministically instead of being raced.
//
// Everything is forwarded to the real module untouched except `linkSync`, which is where the
// publication happens. After the real link succeeds and BEFORE returning to production code — so
// the caller is provably between publication and its cleanup — it writes a ready file and then
// blocks until the parent releases it. The parent sends the signal in between.
//
// The block is a synchronous spin on the filesystem, not a promise or a timer: the child is inside
// a synchronous call, so anything needing its event loop could never resolve. It is bounded, and
// on expiry it gives up and returns rather than hanging the suite; the parent then fails loudly
// instead of the case passing quietly.
import { createRequire } from 'node:module';

const real = createRequire(import.meta.url)('fs');

const READY = process.env.A1_HANDSHAKE_READY;
const RELEASE = process.env.A1_HANDSHAKE_RELEASE;
const LIMIT_MS = Number(process.env.A1_HANDSHAKE_LIMIT_MS ?? '10000');

export const linkSync = (from, to) => {
  const result = real.linkSync(from, to);
  if (READY !== undefined && RELEASE !== undefined) {
    // Writing this file is also the evidence that this shim really is the function production
    // calls: if it never appears, the probe did not engage and the test must not pass.
    real.writeFileSync(READY, 'linked');
    const until = Date.now() + LIMIT_MS;
    while (!real.existsSync(RELEASE) && Date.now() < until) { /* spin: no event loop available */ }
  }
  return result;
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
