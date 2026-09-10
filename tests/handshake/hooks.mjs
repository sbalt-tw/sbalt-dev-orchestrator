/* global URL */
// Test-only resolve hook: `node:fs` becomes the shim, except for the shim itself, which needs the
// genuine module. Nothing else is intercepted. This must be a real file: a data: URL was measured
// not to work for register()'s hooks module.
const SHIM = new URL('./fs-shim.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  const wantsFs = specifier === 'node:fs' || specifier === 'fs';
  const fromShim = context.parentURL === SHIM;
  if (wantsFs && !fromShim) return { url: SHIM, shortCircuit: true };
  return next(specifier, context);
}
