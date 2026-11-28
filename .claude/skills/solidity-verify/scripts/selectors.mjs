#!/usr/bin/env node
// Check that function selectors are dispatched by deployed bytecode (PUSH4 scan; no source needed).
// Usage: node selectors.mjs <chain> <address> "hasDojoPass(address)" "passPurchasedAt(address)" ...
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, rpc } from './lib.mjs';

const [chain, address, ...sigs] = process.argv.slice(2);
if (!chain || !address || !sigs.length) { console.error('usage: node selectors.mjs <chain> <address> <sig>...'); process.exit(2); }
// keccak from solc-js's bundled js-sha3 dependency, so no extra install
const { keccak256 } = createRequire(path.join(ROOT, 'node_modules/solc/package.json'))('js-sha3');
const code = (await rpc(chain, 'eth_getCode', [address, 'latest'])).replace(/^0x/, '').toLowerCase();
if (!code) { console.error('no code at address'); process.exit(1); }

const pushed = new Set();
for (let i = 0; i < code.length; ) {
  const op = parseInt(code.slice(i, i + 2), 16);
  if (op === 0x63) pushed.add(code.slice(i + 2, i + 10));
  i += 2 + (op >= 0x60 && op <= 0x7f ? (op - 0x5f) * 2 : 0);
}
let missing = 0;
for (const s of sigs) {
  const sel = keccak256(s.replace(/\s+/g, '')).slice(0, 8);
  const ok = pushed.has(sel);
  if (!ok) missing++;
  console.log(`${ok ? 'ok     ' : 'MISSING'} 0x${sel} ${s}`);
}
if (code.length / 2 < 200) console.log('note: tiny runtime, probably a proxy; check the implementation address too');
process.exit(missing ? 1 : 0);
