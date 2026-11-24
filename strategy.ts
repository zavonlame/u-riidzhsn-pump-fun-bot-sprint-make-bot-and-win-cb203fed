// Small-stake basket for the pump.fun replay (agent-fun/replay/v2).
//
// What the dev window actually shows (1,222 coins, full 24h window):
// - The first trade is the top, not the signal: buying the first big buy
//   loses money at every horizon (median trip -0.001 to -0.003 SOL), and
//   28 of the 35 "completes" finish in the same slot they are created —
//   already migrated when the collector first sees them, uncatchable at a
//   2-slot latency. Tight scalps, flow momentum, dip-buying (second-wave
//   rate 10%) and sustained-breakout chasing (median final 0.45x of the
//   buy price) were all built and backtested here; every one of them
//   loses on the dev window. At a 2-slot latency with a 1%-of-real-SOL
//   order cap and ~2.5% round-trip curve fees plus fixed tx fees, no
//   tested variant of this bot has a positive edge on the dev data.
// - So this entry is built to lose the least while staying legal and
//   keeping the tail: one uniform 0.01 SOL stake (exactly the guardrail
//   minimum, so every round trip counts, and the size where the fixed
//   105,000-lamport tx fee is only ~1% of the stake) in each coin whose
//   very first trade is a buy of at least 1 SOL, held long (20,000 slots)
//   with a far take-profit (+200%, so the rare runner that migrates pays)
//   and a wide stop (-60%, so the ordinary retrace to the create price
//   does not shake the position out). Measured on the full dev window
//   with the kit's own local engine: net -0.24 SOL, 103 round trips,
//   max drawdown 2.6% — the least losing of every variant tested. The
//   final window is unseen 6h data; the tail exposure is what can pay
//   there, and the small uniform stakes are what keep a bad window cheap.
//
// Bookkeeping carries one hard lesson: a sell the harness rejects
// (slippage on a fast dump) must NOT close the book on the position.
// An earlier version deleted the entry record when it placed the sell,
// so a rejected sell orphaned the position and clogged one of the five
// slots for the rest of the run. This version tracks every order by an
// explicit client_id and only closes the book when the batch's fills
// report the sell as filled; a rejected or failed sell leaves the entry
// in place so the exit logic retries on the next batch.
//
// Nothing reads the clock, the environment or Math.random: every decision
// is a pure function of the hello and the batches, so two runs agree.
// Prices are bonding-curve quotes (virtual_quote_reserves over
// virtual_token_reserves); multiples are compared in basis points with
// bigint cross-multiplication, never floats.

import {
  type Batch,
  type Bot,
  type BotState,
  type OrderInput,
} from './vendor/makefun-bot.ts';

export interface Params {
  /** First-trade buy size (lamports) that triggers the snipe. */
  firstBuyMinLamports: bigint;
  /** Smallest stake worth taking: below this the fixed tx fee eats the
   * trade and the round trip does not count toward the 20-mint guardrail. */
  minStakeLamports: bigint;
  /** Largest stake per coin: keeps one bad coin from dominating. */
  maxStakeLamports: bigint;
  /** Take profit: sell when value is this many bps above cost. */
  takeProfitBps: number;
  /** Stop loss: sell when value is this many bps below cost. */
  stopLossBps: number;
  /** Peak multiple (bps above cost) that arms the trailing stop. */
  trailArmBps: number;
  /** Sell when value falls this many bps below its peak value. */
  trailDropBps: number;
  /** Hard hold limit in slots from the first buy; sell whatever is left. */
  maxHoldSlots: number;
  /** Slippage allowance on every order, in bps. */
  slippageBps: number;
  /** Slots to wait after an exit before the same mint may re-enter. */
  reenterCooldownSlots: number;
}

export const DEFAULT_PARAMS: Params = {
  firstBuyMinLamports: 1_000_000_000n,
  minStakeLamports: 10_000_000n,
  maxStakeLamports: 10_000_000n,
  takeProfitBps: 20000,
  stopLossBps: 6000,
  trailArmBps: 100000,
  trailDropBps: 800,
  maxHoldSlots: 20000,
  slippageBps: 500,
  reenterCooldownSlots: 500,
};

interface Flow {
  createSlot: number;
  trades: number;
  complete: boolean;
}

interface Entry {
  slot: number;
  /** Best value multiple seen, in bps over cost (10000 = breakeven). */
  peakBps: number;
}

const BPS = 10_000n;

export function createStrategy(params: Params = DEFAULT_PARAMS): Bot {
  const flow = new Map<string, Flow>();
  const entries = new Map<string, Entry>();
  const lastExit = new Map<string, number>();
  // client_id -> mint, for sells awaiting their fill report.
  const pendingSells = new Map<string, string>();
  // client_id -> mint, for buys awaiting their fill report.
  const pendingBuys = new Map<string, string>();
  let seq = 0;

  function hasPendingBuy(state: BotState, mint: string): boolean {
    for (const p of state.pending.values()) {
      if (p.order.side === 'buy' && p.order.mint === mint) return true;
    }
    return false;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      seq += 1;
      const orders: OrderInput[] = [];
      const maxOrders = state.hello.caps.max_orders_per_batch;
      const fresh = new Set<string>();
      const firstBuys = new Map<string, bigint>();

      // --- settle the fills reported with this batch ---
      for (const fill of batch.fills) {
        const sellMint = pendingSells.get(fill.client_id);
        if (sellMint !== undefined) {
          pendingSells.delete(fill.client_id);
          if (fill.status === 'filled') {
            entries.delete(sellMint);
            lastExit.set(sellMint, batch.slot);
          }
          // rejected/failed: entry stays, exit logic retries next batch.
        }
        const buyMint = pendingBuys.get(fill.client_id);
        if (buyMint !== undefined) {
          pendingBuys.delete(fill.client_id);
          if (fill.status !== 'filled') {
            // Buy never landed: drop the entry so the mint can be reconsidered.
            const e = entries.get(buyMint);
            if (e !== undefined && !state.positions.has(buyMint)) entries.delete(buyMint);
          }
        }
      }

      // --- fold this batch's events into the per-coin flow table ---
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          flow.set(e.mint, { createSlot: e.slot, trades: 0, complete: false });
        } else if (e.event === 'TradeEvent') {
          const f = flow.get(e.mint);
          if (f === undefined) continue;
          f.trades += 1;
          if (f.trades === 1 && e.is_buy) firstBuys.set(e.mint, BigInt(e.sol_amount));
          fresh.add(e.mint);
        } else if (e.event === 'CompleteEvent') {
          const f = flow.get(e.mint);
          if (f !== undefined) f.complete = true;
          entries.delete(e.mint);
        }
      }

      // --- exits: sell the full position on TP / SL / trailing / timeout ---
      for (const [mint, pos] of state.positions) {
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const entry = entries.get(mint);
        if (entry === undefined) continue;
        if ([...pendingSells.values()].includes(mint)) continue;
        const tokens = pos.token_amount;
        if (tokens === 0n) continue;
        const value =
          (tokens * curve.virtual_quote_reserves) / curve.virtual_token_reserves;
        const cost = pos.cost_lamports;
        if (cost === 0n) continue;
        const bps = Number((value * BPS) / cost);
        if (bps > entry.peakBps) entry.peakBps = bps;
        const held = batch.slot - entry.slot;
        const takeProfit = bps >= 10_000 + params.takeProfitBps;
        const stopLoss = bps <= 10_000 - params.stopLossBps;
        const trailing =
          entry.peakBps >= 10_000 + params.trailArmBps &&
          bps * 10_000 <= entry.peakBps * (10_000 - params.trailDropBps);
        const timedOut = held >= params.maxHoldSlots;
        if (takeProfit || stopLoss || trailing || timedOut) {
          const cid = `s-${seq}-${mint.slice(0, 8)}`;
          orders.push({
            side: 'sell',
            mint,
            token_amount: tokens,
            max_slippage_bps: params.slippageBps,
            client_id: cid,
          });
          pendingSells.set(cid, mint);
        }
      }

      // --- prune entry records whose buy never filled ---
      for (const [mint, entry] of entries) {
        if (
          !state.positions.has(mint) &&
          !hasPendingBuy(state, mint) &&
          batch.slot - entry.slot > 10
        ) {
          entries.delete(mint);
        }
      }

      // --- snipe: a coin's very first trade is a big buy ---
      for (const mint of fresh) {
        if (orders.length >= maxOrders) break;
        const firstBuy = firstBuys.get(mint);
        if (firstBuy === undefined) continue;
        if (firstBuy < params.firstBuyMinLamports) continue;
        const f = flow.get(mint);
        if (f === undefined || f.complete) continue;
        if (state.positions.has(mint) || entries.has(mint)) continue;
        if (hasPendingBuy(state, mint)) continue;
        const last = lastExit.get(mint);
        if (last !== undefined && batch.slot - last < params.reenterCooldownSlots) continue;
        if (
          state.committedPositionCount() +
            orders.filter((o) => o.side === 'buy').length >=
          state.hello.caps.max_open_positions
        ) {
          continue;
        }
        const cap = state.maxBuyLamports(mint);
        if (cap < params.minStakeLamports) continue;
        const free = state.freeCashLamports() - state.txFeeLamports() * 2n;
        let stake = cap;
        if (stake > params.maxStakeLamports) stake = params.maxStakeLamports;
        if (stake > free) stake = free;
        if (stake <= 0n) continue;
        const cid = `b-${seq}-${mint.slice(0, 8)}`;
        orders.push({
          side: 'buy',
          mint,
          quote_lamports: stake,
          max_slippage_bps: params.slippageBps,
          client_id: cid,
        });
        pendingBuys.set(cid, mint);
        entries.set(mint, { slot: batch.slot, peakBps: 10_000 });
      }

      return orders;
    },
  };
}
