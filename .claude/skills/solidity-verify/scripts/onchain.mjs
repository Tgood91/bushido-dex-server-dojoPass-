#!/usr/bin/env node
// Compare deployed runtime code against a fresh compile (immutables masked, metadata stripped).
// Usage: node onchain.mjs <chain> <address> <path.sol:Contract>
import { compile, stripMetadata, rpc, target } from './lib.mjs';

const [chain, address, spec] = process.argv.slice(2);
if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(address || '')) {
  console.error('usage: node onchain.mjs <chain> <address> <path.sol:Contract>');
  process.exit(2);
}
const [entry, name] = target(spec);
const code = (await rpc(chain, 'eth_getCode', [address, 'latest'])).replace(/^0x/, '');
if (!code) { console.error(`${chain} ${address}: no code`); process.exit(1); }
if (code.startsWith('ef0100')) { console.error(`${chain} ${address}: EIP-7702 delegation, not a contract`); process.exit(1); }

const c = compile(entry, name);
let local = c.deployed.replace(/^0x/, '');
let chainCode = code;
const mask = (hex, start, len) => hex.slice(0, start * 2) + '0'.repeat(len * 2) + hex.slice((start + len) * 2);
const immutables = {};
for (const [id, refs] of Object.entries(c.immutables)) {
  for (const { start, length } of refs) {
    immutables[id] = '0x' + chainCode.slice(start * 2, (start + length) * 2);
    chainCode = mask(chainCode, start, length);
    local = mask(local, start, length);
  }
}
const exact = chainCode === local;
const codeOnly = stripMetadata(chainCode) === stripMetadata(local);
console.log(`${name} @ ${chain} ${address}`);
console.log(`  runtime ${(code.length) / 2} bytes, immutables ${JSON.stringify(immutables)}`);
console.log(`  ${exact ? 'EXACT match' : codeOnly ? 'CODE match, metadata hash differs (partial)' : 'MISMATCH'}`);
process.exit(codeOnly ? 0 : 1);
