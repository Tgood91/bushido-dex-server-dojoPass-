#!/usr/bin/env node
// Submit standard-JSON verification to the Etherscan V2 API (one key covers Base, Base Sepolia, Monad,
// Monad testnet) and poll the result. Key from ETHERSCAN_API_KEY; never pass it on the command line.
// Usage: node verify.mjs <chain> <address> <path.sol:Contract> [--args 0x<abi-encoded constructor args>]
import { compile, CHAINS, target } from './lib.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--args');
const ctorArgs = i >= 0 ? argv.splice(i, 2)[1].replace(/^0x/, '') : '';
const [chain, address, spec] = argv;
if (!CHAINS[chain] || !/^0x[0-9a-fA-F]{40}$/.test(address || '')) {
  console.error(`usage: node verify.mjs <${Object.keys(CHAINS).join('|')}> <address> <path.sol:Contract> [--args 0x..]`);
  process.exit(2);
}
if (!/^([0-9a-fA-F]{64})*$/.test(ctorArgs)) { console.error('--args must be ABI-encoded 32-byte words'); process.exit(2); }
const key = process.env.ETHERSCAN_API_KEY;
if (!key) { console.error('ETHERSCAN_API_KEY is not set'); process.exit(2); }

const [entry, name] = target(spec);
const c = compile(entry, name);
const api = `https://api.etherscan.io/v2/api?chainid=${CHAINS[chain].id}`;
const body = new URLSearchParams({
  apikey: key, module: 'contract', action: 'verifysourcecode', contractaddress: address,
  sourceCode: JSON.stringify(c.input), codeformat: 'solidity-standard-json-input',
  contractname: `${entry}:${name}`, compilerversion: 'v' + c.version, constructorArguements: ctorArgs,
});
const sub = await (await fetch(api, { method: 'POST', body })).json();
if (sub.status !== '1') {
  if (/already verified/i.test(sub.result)) { console.log('already verified'); process.exit(0); }
  console.error('submit failed:', sub.result); process.exit(1);
}
console.log('submitted, guid', sub.result);
for (let n = 0; n < 20; n++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await (await fetch(`${api}&module=contract&action=checkverifystatus&guid=${sub.result}&apikey=${key}`)).json();
  if (/pending/i.test(st.result)) continue;
  console.log(st.result);
  process.exit(st.status === '1' ? 0 : 1);
}
console.error('timed out waiting for verification'); process.exit(1);
