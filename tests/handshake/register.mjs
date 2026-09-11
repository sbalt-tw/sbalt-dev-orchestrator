/* global URL */
// Test-only entry for `node --import`. Redirects `node:fs` to the shim for the child process.
//
// A plain `fs.linkSync = ...` monkey patch does not work here and was measured not to: production
// uses an ESM *named* import, whose binding is established when the module is linked and does not
// observe a later property assignment on the namespace. Redirecting the specifier does work,
// because the importer then binds to the shim's own export.
import { register } from 'node:module';

register(new URL('./hooks.mjs', import.meta.url));
