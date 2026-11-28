// Shared helpers for the solidity-verify scripts. Node >= 20, no deps beyond contracts/node_modules.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const ROOT = path.resolve(process.env.CONTRACTS_ROOT || 'contracts');

/** Same settings as Tgood91/Bushido-future roadmap/contracts/foundry.toml, so the bytecode matches. */
export const CONFIG = {
  solcVersion: '0.8.24',
  optimizer: { enabled: true, runs: 200 },
  evmVersion: process.env.EVM_VERSION || 'cancun',
  remappings: [
    'solady/=node_modules/solady/src/',
    '@hyperlane-xyz/core/=node_modules/@hyperlane-xyz/core/',
    '@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/',
    '@openzeppelin/contracts-upgradeable/=node_modules/@openzeppelin/contracts-upgradeable/',
  ],
};

export function loadSolc() {
  const req = createRequire(path.join(ROOT, 'package.json'));
  const solc = req('solc');
  const v = solc.version();
  if (!v.startsWith(CONFIG.solcVersion + '+')) throw new Error(`solc ${v} loaded, need ${CONFIG.solcVersion}`);
  return solc;
}

function resolveImport(from, spec) {
  if (spec.startsWith('./') || spec.startsWith('../')) return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const r of CONFIG.remappings) {
    const [prefix, target] = r.split('=');
    if (spec.startsWith(prefix)) return target + spec.slice(prefix.length);
  }
  return spec;
}

/** Source units keyed by project-relative path (as Foundry names them), closed over imports. */
export function collectSources(entry) {
  const sources = {};
  const queue = [entry];
  while (queue.length) {
    const unit = queue.pop();
    if (sources[unit]) continue;
    const file = path.join(ROOT, unit);
    if (!existsSync(file)) throw new Error(`missing source ${unit} (run npm ci in ${ROOT})`);
    const content = readFileSync(file, 'utf8');
    sources[unit] = { content };
    for (const m of content.matchAll(/^\s*import\s+(?:[^'"]*from\s+)?["']([^"']+)["']/gm)) queue.push(resolveImport(unit, m[1]));
  }
  return Object.fromEntries(Object.keys(sources).sort().map((k) => [k, sources[k]]));
}

export function standardInput(entry) {
  return {
    language: 'Solidity',
    sources: collectSources(entry),
    settings: {
      remappings: CONFIG.remappings,
      optimizer: CONFIG.optimizer,
      metadata: { useLiteralContent: false, bytecodeHash: 'ipfs', appendCBOR: true },
      evmVersion: CONFIG.evmVersion,
      libraries: {},
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] } },
    },
  };
}

export function compile(entry, name) {
  const solc = loadSolc();
  const input = standardInput(entry);
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const c = out.contracts[entry][name];
  if (!c) throw new Error(`${name} not found in ${entry}`);
  return { input, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object, deployed: '0x' + c.evm.deployedBytecode.object, immutables: c.evm.deployedBytecode.immutableReferences || {}, metadata: c.metadata, version: solc.version() };
}

/** Strip the trailing CBOR metadata (length in the last 2 bytes). */
export function stripMetadata(hex) {
  const h = hex.replace(/^0x/, '');
  const len = parseInt(h.slice(-4), 16);
  return h.slice(0, h.length - (len + 2) * 2);
}

export const CHAINS = {
  base: { id: 8453, rpc: 'https://mainnet.base.org' },
  'base-sepolia': { id: 84532, rpc: 'https://sepolia.base.org' },
  monad: { id: 143, rpc: 'https://rpc.monad.xyz' },
  'monad-testnet': { id: 10143, rpc: 'https://testnet-rpc.monad.xyz' },
};

export async function rpc(chain, method, params) {
  const c = CHAINS[chain];
  if (!c) throw new Error(`unknown chain ${chain}; one of ${Object.keys(CHAINS).join(', ')}`);
  const url = process.env[`RPC_${chain.toUpperCase().replace('-', '_')}`] || c.rpc;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

/** "src/dna/DojoPassDNA.sol:DojoPassDNA" -> [entry, name] */
export function target(spec) {
  const [entry, name] = String(spec || '').split(':');
  if (!entry || !name) throw new Error(`target must be <path.sol>:<Contract>, got "${spec}"`);
  return [entry, name];
}
