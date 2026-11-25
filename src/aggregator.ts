import type { Address } from 'viem';
import { CHAINS, CHAIN_KEYS, clientFor, dojoPassAbi, honorAbi, type ChainConfig, type ChainKey } from './chains.js';

export const VIRTUES = ['Gi', 'Yu', 'Jin', 'Rei', 'Makoto', 'Meiyo', 'Chugi', 'Jisei'] as const;
export type Virtue = (typeof VIRTUES)[number];
/** Virtues HONOR records on-chain today (getVirtueScores order). The rest have no feed yet. */
export const RECORDED_VIRTUES: readonly Virtue[] = ['Gi', 'Yu', 'Jin', 'Rei', 'Makoto'];

export type Rank = 'Tsurano' | 'Samurai' | 'Bushido Master' | 'Shogun';

/** A value with no source yet. Rendered honestly, never as a fake 0. */
export const NOT_RECORDED = 'Not yet recorded' as const;
type Maybe<T> = T | typeof NOT_RECORDED;

export interface PassAttributes {
  chain: ChainKey;
  holder: Address;
  practitioner: boolean;
  passPurchasedAt: number; // unix seconds
  passAgeDays: number;
  recordedTrades: Maybe<number>;
  disciplineVolumeUsd: Maybe<number>;
  checkInStreak: Maybe<number>;
  totalCheckIns: Maybe<number>;
  homeChain: ChainKey;
  standing: number; // 0-100
  rank: Rank;
  virtues: Record<Virtue, { level: number; recorded: boolean }>;
}

export class NoPassError extends Error {
  constructor(chain: ChainKey, holder: string) {
    super(`No Dojo Pass for ${holder} on ${chain}`);
  }
}

export class ChainNotConfiguredError extends Error {
  constructor(chain: ChainKey) {
    super(`No Dojo Pass registry configured for ${chain}`);
  }
}

/** Canon bands, same thresholds as Android CheckInStore.kt and web App.tsx. */
export function rankFromStanding(standing: number): Rank {
  if (standing >= 90) return 'Shogun';
  if (standing >= 75) return 'Bushido Master';
  if (standing >= 60) return 'Samurai';
  return 'Tsurano';
}

/** HONOR virtue score 0-10 -> armour tier 0-4. */
export function virtueLevel(score: number): number {
  return Math.max(0, Math.min(4, Math.ceil(score / 2.5)));
}

export interface PassRead { has: boolean; purchasedAt: number; practitioner: boolean }
export interface HonorRead { tradeCount: number; honorScore: number; virtueScores: number[] }

/** Everything the aggregator needs from chain. Injected so tests can stub RPC. */
export interface PassReader {
  pass(chain: ChainConfig, holder: Address): Promise<PassRead>;
  /** null when the network has no HONOR feed. */
  honor(chain: ChainConfig, holder: Address): Promise<HonorRead | null>;
}

export const rpcReader: PassReader = {
  async pass(cfg, holder) {
    const c = clientFor(cfg.key);
    const address = cfg.dojoPass!;
    const [has, purchasedAt, practitioner] = await Promise.all([
      c.readContract({ address, abi: dojoPassAbi, functionName: 'hasDojoPass', args: [holder] }),
      c.readContract({ address, abi: dojoPassAbi, functionName: 'passPurchasedAt', args: [holder] }),
      c.readContract({ address, abi: dojoPassAbi, functionName: 'isPractitioner', args: [holder] }),
    ]);
    return { has, purchasedAt: Number(purchasedAt), practitioner };
  },
  async honor(cfg, holder) {
    if (!cfg.honor) return null;
    const c = clientFor(cfg.honor.chain);
    const address = cfg.honor.address;
    const [tradeCount, honorScore, scores] = await Promise.all([
      c.readContract({ address, abi: honorAbi, functionName: 'tradeCount', args: [holder] }),
      c.readContract({ address, abi: honorAbi, functionName: 'honorScores', args: [holder] }),
      c.readContract({ address, abi: honorAbi, functionName: 'getVirtueScores', args: [holder] }),
    ]);
    return { tradeCount: Number(tradeCount), honorScore: Number(honorScore), virtueScores: scores.map(Number) };
  },
};

export async function getPassAttributes(
  chain: ChainKey,
  holder: Address,
  reader: PassReader = rpcReader,
  now: number = Math.floor(Date.now() / 1000),
  chains: Record<ChainKey, ChainConfig> = CHAINS,
): Promise<PassAttributes> {
  const self = chains[chain];
  if (!self.dojoPass) throw new ChainNotConfiguredError(chain);
  // Home chain is picked among configured chains of the same network (mainnet or testnet).
  const peers = CHAIN_KEYS.filter((k) => chains[k].network === self.network && chains[k].dojoPass);
  const [passes, honor] = await Promise.all([
    Promise.all(peers.map(async (k) => [k, await reader.pass(chains[k], holder)] as const)),
    reader.honor(self, holder),
  ]);
  const byChain = new Map<ChainKey, PassRead>(passes);
  const mine = byChain.get(chain)!;
  if (!mine.has) throw new NoPassError(chain, holder);

  const virtues = {} as PassAttributes['virtues'];
  for (const v of VIRTUES) {
    const i = RECORDED_VIRTUES.indexOf(v);
    virtues[v] = honor && i >= 0 ? { level: virtueLevel(honor.virtueScores[i] ?? 0), recorded: true } : { level: 0, recorded: false };
  }

  const standing = honor ? Math.max(0, Math.min(100, honor.honorScore)) : 0;
  return {
    chain,
    holder,
    practitioner: mine.practitioner,
    passPurchasedAt: mine.purchasedAt,
    passAgeDays: Math.max(0, Math.floor((now - mine.purchasedAt) / 86400)),
    recordedTrades: honor ? honor.tradeCount : NOT_RECORDED,
    disciplineVolumeUsd: NOT_RECORDED,
    checkInStreak: NOT_RECORDED,
    totalCheckIns: NOT_RECORDED,
    homeChain: homeChain(byChain, honor, self, chains),
    standing,
    rank: rankFromStanding(standing),
    virtues,
  };
}

/**
 * Chain with the most Bushido activity. Recorded HONOR trades make the HONOR chain home;
 * otherwise the earliest pass held on this network.
 */
function homeChain(byChain: Map<ChainKey, PassRead>, honor: HonorRead | null, self: ChainConfig, chains: Record<ChainKey, ChainConfig>): ChainKey {
  if (honor && honor.tradeCount > 0 && self.honor && chains[self.honor.chain].network === self.network) return self.honor.chain;
  const held = [...byChain.entries()].filter(([, p]) => p.has).sort((a, b) => a[1].purchasedAt - b[1].purchasedAt);
  return held[0]?.[0] ?? self.key;
}
