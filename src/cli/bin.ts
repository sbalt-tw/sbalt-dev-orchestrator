#!/usr/bin/env node
// The executable. This file is the one with a side effect: importing it runs the command.
//
// Round 16 separated it from the module. `dist/cli/index.js` previously decided for itself
// whether it was the program, by comparing `process.argv[1]` against its own resolved path — and
// that is not a fact about the module, it is a user-controlled positional argument. Under
// `node -e`, passing the CLI's own path as the first argument made the check true, so a dynamic
// import ran the command and, in a writable directory, created the database in the importing
// process.
//
// `import.meta.main` would answer the question properly, but it is not available across the whole
// range this package supports (`engines: >=22`), and the floor is not being raised to get it. A
// separate bootstrap needs no such feature and behaves the same on every supported version.
//
// So the split is explicit rather than clever: `index.js` exports and does nothing; this file
// does something and exports nothing. No claim is made that every file under `dist/` is free of
// side effects — this one is not, and that is its whole purpose.
import { main } from './index.js';

void main();
