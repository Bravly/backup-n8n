#! /usr/bin/env node

const cli = require('../dist/cli.js');
if (cli && typeof cli.main === 'function') {
  cli.main().catch((e) => {
    console.error('Unexpected error:', e);
    process.exit(1);
  });
} else {
  console.error('Failed to load CLI.');
  process.exit(1);
}
