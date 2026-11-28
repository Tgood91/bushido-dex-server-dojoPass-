#!/usr/bin/env node
// Compile contracts with the pinned settings, write standard-JSON input + artifacts to contracts/out/,
// and compare against contracts/reference.json (the bytecode the burner page deploys).
// Usage: node build.mjs [src/dna/DojoPassDNA.sol:DojoPassDNA ...]
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, CONFIG, compile, stripMetadata, target } from './lib.mjs';

const targets = process.argv.slice(2);
if (!targets.length) targets.push('src/dna/DojoPassDNA.sol:DojoPassDNA', 'src/testnet/TestDojoPass.sol:TestDojoPass');
const refFile = path.join(ROOT, 'reference.json');
const ref = existsSync(refFile) ? JSON.parse(readFileSync(refFile, 'utf8')) : {};
mkdirSync(path.join(ROOT, 'out'), { recursive: true });

let failed = 0;
for (const t of targets) {
  const [entry, name] = target(t);
  const c = compile(entry, name);
  writeFileSync(path.join(ROOT, 'out', `${name}.standard-input.json`), JSON.stringify(c.input, null, 1) + '\n');
  writeFileSync(path.join(ROOT, 'out', `${name}.json`), JSON.stringify({ compiler: c.version, evmVersion: CONFIG.evmVersion, abi: c.abi, bytecode: c.bytecode, deployedBytecode: c.deployed, immutableReferences: c.immutables }, null, 1) + '\n');
  const r = ref[name]?.bytecode;
  let verdict = 'no reference';
  if (r) {
    if (c.bytecode === r) verdict = 'EXACT match (metadata hash included)';
    else if (stripMetadata(c.bytecode) === stripMetadata(r)) verdict = 'CODE match, metadata hash differs (partial match)';
    else { verdict = 'MISMATCH'; failed++; }
  }
  console.log(`${name}: solc ${c.version}, evm ${CONFIG.evmVersion}, ${(c.bytecode.length - 2) / 2} bytes -> ${verdict}`);
}
process.exit(failed ? 1 : 0);
