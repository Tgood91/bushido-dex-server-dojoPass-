import { createPublicClient, defineChain, http, isAddress, type Address, type Chain, type PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';

export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
});

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  testnet: true,
});

export type ChainKey = 'base' | 'monad' | 'base-sepolia' | 'monad-testnet';
export type Family = 'base' | 'monad';
export type Network = 'mainnet' | 'testnet';

export interface ChainConfig {
  key: ChainKey;
  name: string;
  family: Family; // drives the colour scheme
  network: Network; // home chain is chosen within one network
  chain: Chain;
  rpc?: string;
  /** Dojo Pass registry (hasDojoPass / passPurchasedAt / isPractitioner). Undefined = not configured. */
  dojoPass?: Address;
  /** HONOR feed read for holders on this network, if any. */
  honor?: { chain: ChainKey; address: Address };
}

const HONOR_MONAD: Address = '0x46D5F4924F833Cd4054A36eAEfa3bEca6cD92A7e';

function envAddress(name: string, env: NodeJS.ProcessEnv): Address | undefined {
  const v = env[name]?.trim();
  if (!v) return undefined;
  if (!isAddress(v)) throw new Error(`${name} is not an address: ${v}`);
  return v;
}

/**
 * Mainnet registries are the live Dojo Pass contracts (selectors verified against bytecode
 * 2026-11-24). Testnets have no live registry: set DOJO_PASS_BASE_SEPOLIA / DOJO_PASS_MONAD_TESTNET
 * to the TestDojoPass that burner step D1 deploys. RPCs can be overridden with RPC_<KEY>.
 */
export function loadChains(env: NodeJS.ProcessEnv = process.env): Record<ChainKey, ChainConfig> {
  const rpc = (k: string) => env[`RPC_${k.toUpperCase().replace('-', '_')}`]?.trim() || undefined;
  return {
    base: {
      key: 'base', name: 'Base', family: 'base', network: 'mainnet', chain: base, rpc: rpc('base'),
      dojoPass: '0x6B6A971a0aaab34E70659E0723AD0dCe129f7D9c',
      honor: { chain: 'monad', address: HONOR_MONAD },
    },
    monad: {
      key: 'monad', name: 'Monad', family: 'monad', network: 'mainnet', chain: monad, rpc: rpc('monad'),
      dojoPass: '0x2647faf3aaA708D0B9a110744790E1f637FCca53',
      honor: { chain: 'monad', address: HONOR_MONAD },
    },
    'base-sepolia': {
      key: 'base-sepolia', name: 'Base Sepolia', family: 'base', network: 'testnet', chain: baseSepolia,
      rpc: rpc('base-sepolia'), dojoPass: envAddress('DOJO_PASS_BASE_SEPOLIA', env),
    },
    'monad-testnet': {
      key: 'monad-testnet', name: 'Monad Testnet', family: 'monad', network: 'testnet', chain: monadTestnet,
      rpc: rpc('monad-testnet'), dojoPass: envAddress('DOJO_PASS_MONAD_TESTNET', env),
    },
  };
}

export const CHAINS = loadChains();
export const CHAIN_KEYS = Object.keys(CHAINS) as ChainKey[];

export const dojoPassAbi = [
  { type: 'function', name: 'hasDojoPass', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'passPurchasedAt', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'isPractitioner', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

export const honorAbi = [
  { type: 'function', name: 'tradeCount', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'honorScores', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  // 5 static words: Gi, Yu, Jin, Rei, Makoto (each 0-10, per HONOR's revert string)
  {
    type: 'function', name: 'getVirtueScores', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
  },
] as const;

const clients = new Map<ChainKey, PublicClient>();
export function clientFor(key: ChainKey): PublicClient {
  let c = clients.get(key);
  if (!c) {
    const cfg = CHAINS[key];
    c = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) }) as PublicClient;
    clients.set(key, c);
  }
  return c;
}
