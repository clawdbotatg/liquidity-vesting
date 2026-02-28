"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import { WalletBalances } from "~~/components/WalletBalances";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const TICK_SPACING = 200;
const TRACK_HALF_STEPS = 200; // ±200 steps from current tick (~55x max range)
const NPM_ADDRESS = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";

function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick); // CLAWD per WETH
}

function sqrtPriceFromTick(tick: number): number {
  return Math.sqrt(Math.pow(1.0001, tick));
}

function wethToClawd(w: number, sqrtPriceCurrent: number, spL: number, spU: number): number {
  if (sqrtPriceCurrent <= spL) return 0;
  const sp = Math.min(sqrtPriceCurrent, spU);
  const L = (w * sp * spU) / (spU - sp);
  return L * (sp - spL);
}

function clawdToWeth(c: number, sqrtPriceCurrent: number, spL: number, spU: number): number {
  if (sqrtPriceCurrent >= spU) return 0;
  const sp = Math.max(sqrtPriceCurrent, spL);
  const L = c / (sp - spL);
  return (L * (spU - sp)) / (sp * spU);
}

function fmtClawdUsd(tick: number, ethPrice: number): string {
  if (!ethPrice) return "—";
  const usd = ethPrice / tickToPrice(tick);
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  if (usd >= 0.0001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(8)}`;
}

function fmtMultiplier(tick: number, clawdPerWeth: number): string {
  if (!clawdPerWeth) return "";
  const ratio = clawdPerWeth / tickToPrice(tick);
  if (ratio >= 1) return `${ratio.toFixed(2)}x`;
  return `${ratio.toFixed(2)}x`;
}

export default function LPPage() {
  const { address: connectedAddress } = useAccount();
  const { price: ethPrice } = useFetchNativeCurrencyPrice();

  const { data: slot0 } = useScaffoldReadContract({
    contractName: "UniswapV3Pool",
    functionName: "slot0",
    watch: true,
  });

  const sqrtPriceX96 = slot0?.[0] as bigint | undefined;

  // Use bigint math to avoid float64 precision loss on 96-bit sqrtPrice
  const clawdPerWeth: number = (() => {
    if (!sqrtPriceX96 || !ethPrice) return 0;
    const Q96 = 2n ** 96n;
    const SCALE = 10n ** 18n;
    const ratioScaled = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / (Q96 * Q96);
    return Number(ratioScaled) / 1e18;
  })();

  // Float sqrtPrice for liquidity math (acceptable precision for amount calculations)
  const sqrtPriceCurrent = sqrtPriceX96 ? Number(sqrtPriceX96) / 2 ** 96 : 0;

  const clawdUsdCurrent = clawdPerWeth > 0 && ethPrice > 0 ? ethPrice / clawdPerWeth : 0;

  const currentTick =
    clawdPerWeth > 0
      ? Math.round(Math.floor(Math.log(clawdPerWeth) / Math.log(1.0001)) / TICK_SPACING) * TICK_SPACING
      : 0;

  const [tickLower, setTickLower] = useState(0);
  const [tickUpper, setTickUpper] = useState(0);
  const [wethInput, setWethInput] = useState("");
  const [clawdInput, setClawdInput] = useState("");
  const [lastEdited, setLastEdited] = useState<"weth" | "clawd">("weth");

  useEffect(() => {
    if (currentTick !== 0 && tickLower === 0 && tickUpper === 0) {
      setTickLower(currentTick - 50 * TICK_SPACING);
      setTickUpper(currentTick + 50 * TICK_SPACING);
    }
  }, [currentTick, tickLower, tickUpper]);

  // Track bounds & position helpers
  const trackMin = currentTick - TRACK_HALF_STEPS * TICK_SPACING;
  const trackMax = currentTick + TRACK_HALF_STEPS * TICK_SPACING;

  // Inverted axis: higher tick = cheaper CLAWD = LEFT side; lower tick = pricier CLAWD = RIGHT side
  // This makes the slider intuitive: left = low USD price, right = high USD price
  const tickToPct = (tick: number) =>
    Math.max(0, Math.min(100, 100 - ((tick - trackMin) / (trackMax - trackMin)) * 100));

  const pctToTick = (pct: number) => {
    const raw = trackMin + ((100 - pct) / 100) * (trackMax - trackMin);
    return Math.round(raw / TICK_SPACING) * TICK_SPACING;
  };

  // Left handle = tickUpper (lower CLAWD USD), Right handle = tickLower (higher CLAWD USD)
  const leftPct = tickToPct(tickUpper);
  const rightPct = tickToPct(tickLower);
  const currentPct = tickToPct(currentTick);

  // Drag handling — setPointerCapture, no window listeners, no stale refs
  const trackRef = useRef<HTMLDivElement>(null);

  const getPct = useCallback((e: React.PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  }, []);

  // Recalculate amounts
  const recalc = useCallback(
    (edited: "weth" | "clawd", wVal: string, cVal: string) => {
      if (!sqrtPriceCurrent) return;
      const spL = sqrtPriceFromTick(tickLower);
      const spU = sqrtPriceFromTick(tickUpper);
      if (edited === "weth" && wVal) {
        const w = parseFloat(wVal);
        if (!isNaN(w) && w > 0) {
          const c = wethToClawd(w, sqrtPriceCurrent, spL, spU);
          setClawdInput(c > 0 ? c.toFixed(2) : "0");
        }
      } else if (edited === "clawd" && cVal) {
        const c = parseFloat(cVal);
        if (!isNaN(c) && c > 0) {
          const w = clawdToWeth(c, sqrtPriceCurrent, spL, spU);
          setWethInput(w > 0 ? w.toFixed(8) : "0");
        }
      }
    },
    [sqrtPriceCurrent, tickLower, tickUpper],
  );

  useEffect(() => {
    recalc(lastEdited, wethInput, clawdInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickLower, tickUpper]);

  // Allowances & writes
  const { data: wethAllowance } = useScaffoldReadContract({
    contractName: "WETH",
    functionName: "allowance",
    args: [connectedAddress, NPM_ADDRESS],
  });
  const { data: clawdAllowance } = useScaffoldReadContract({
    contractName: "CLAWD",
    functionName: "allowance",
    args: [connectedAddress, NPM_ADDRESS],
  });

  const { writeContractAsync: writeWeth, isMining: wethMining } = useScaffoldWriteContract({ contractName: "WETH" });
  const { writeContractAsync: writeClawd, isMining: clawdMining } = useScaffoldWriteContract({ contractName: "CLAWD" });
  const { writeContractAsync: writeNPM, isMining: npmMining } = useScaffoldWriteContract({
    contractName: "NonfungiblePositionManager",
  });

  const wethAmountBn = wethInput ? parseUnits(wethInput, 18) : 0n;
  const clawdAmountBn = clawdInput ? parseUnits(clawdInput, 18) : 0n;

  const needWethApproval = wethAllowance !== undefined && wethAmountBn > 0n && (wethAllowance as bigint) < wethAmountBn;
  const needClawdApproval =
    clawdAllowance !== undefined && clawdAmountBn > 0n && (clawdAllowance as bigint) < clawdAmountBn;

  return (
    <div className="flex flex-col items-center pt-10 px-4">
      <WalletBalances />
      <div className="w-full max-w-lg space-y-6">
        {/* Price Range Selector */}
        <div className="bg-base-200 rounded-xl p-6">
          {/* Current Price */}
          <div className="text-center mb-8">
            <div className="text-xs opacity-50 mb-1">Current CLAWD Price</div>
            <div className="text-2xl font-bold">{clawdUsdCurrent > 0 ? fmtClawdUsd(currentTick, ethPrice) : "..."}</div>
          </div>

          {/* Dual-handle track */}
          <div className="px-4 mb-12">
            {/* Outer container — handles use this for getBoundingClientRect */}
            <div ref={trackRef} className="relative h-8 flex items-center select-none">
              {/* Track background line */}
              <div className="absolute left-0 right-0 h-2 bg-base-300 rounded-full" />

              {/* Active fill — left handle to center */}
              <div
                className="absolute h-2 rounded-l-full"
                style={{ left: `${leftPct}%`, width: `${currentPct - leftPct}%`, backgroundColor: "#fb923c" }}
              />
              {/* Active fill — center to right handle */}
              <div
                className="absolute h-2 rounded-r-full"
                style={{ left: `${currentPct}%`, width: `${rightPct - currentPct}%`, backgroundColor: "#fb923c" }}
              />

              {/* Current price marker */}
              <div
                className="absolute -translate-x-1/2 pointer-events-none flex flex-col items-center"
                style={{ left: `${currentPct}%` }}
              >
                <div className="text-xs opacity-50 mb-1 whitespace-nowrap" style={{ marginTop: "-20px" }}>
                  now
                </div>
                <div className="w-0.5 h-6 bg-warning" />
              </div>

              {/* Left handle — min USD price (tickUpper) */}
              <div
                className="absolute -translate-x-1/2 w-5 h-5 bg-base-100 border-2 border-warning rounded-full cursor-grab active:cursor-grabbing shadow-md z-10 touch-none"
                style={{ left: `${leftPct}%` }}
                onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)}
                onPointerMove={e => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const tick = pctToTick(getPct(e));
                  if (tick > tickLower) setTickUpper(tick);
                }}
              >
                <div className="absolute top-7 left-1/2 -translate-x-1/2 bg-base-300 rounded px-2 py-1 text-xs font-bold whitespace-nowrap shadow flex flex-col items-center gap-0.5 pointer-events-none">
                  <span>{fmtClawdUsd(tickUpper, ethPrice)}</span>
                  <span className="opacity-60 font-normal">{fmtMultiplier(tickUpper, clawdPerWeth)}</span>
                </div>
              </div>

              {/* Right handle — max USD price (tickLower) */}
              <div
                className="absolute -translate-x-1/2 w-5 h-5 bg-base-100 border-2 border-warning rounded-full cursor-grab active:cursor-grabbing shadow-md z-10 touch-none"
                style={{ left: `${rightPct}%` }}
                onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)}
                onPointerMove={e => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const tick = pctToTick(getPct(e));
                  if (tick < tickUpper) setTickLower(tick);
                }}
              >
                <div className="absolute top-7 left-1/2 -translate-x-1/2 bg-base-300 rounded px-2 py-1 text-xs font-bold whitespace-nowrap shadow flex flex-col items-center gap-0.5 pointer-events-none">
                  <span>{fmtClawdUsd(tickLower, ethPrice)}</span>
                  <span className="opacity-60 font-normal">{fmtMultiplier(tickLower, clawdPerWeth)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Range summary */}
          <div className="flex justify-between text-xs">
            <div>
              <div className="opacity-60">Min price</div>
              <div className="font-bold">{fmtClawdUsd(tickUpper, ethPrice)}</div>
              <div className="opacity-60">{fmtMultiplier(tickUpper, clawdPerWeth)} of current</div>
            </div>
            <div className="text-right">
              <div className="opacity-60">Max price</div>
              <div className="font-bold">{fmtClawdUsd(tickLower, ethPrice)}</div>
              <div className="opacity-60">{fmtMultiplier(tickLower, clawdPerWeth)} of current</div>
            </div>
          </div>
        </div>

        {/* Amount Inputs */}
        <div className="bg-base-200 rounded-xl p-4 space-y-3">
          <div>
            <label className="text-sm font-semibold">WETH Amount</label>
            <input
              type="number"
              className="input input-bordered w-full"
              placeholder="0.0"
              value={wethInput}
              onChange={e => {
                setWethInput(e.target.value);
                setLastEdited("weth");
                recalc("weth", e.target.value, clawdInput);
              }}
            />
            {wethInput && parseFloat(wethInput) > 0 && ethPrice > 0 && (
              <p className="text-xs opacity-50 mt-1 ml-1">≈ ${(parseFloat(wethInput) * ethPrice).toFixed(2)} USD</p>
            )}
          </div>
          <div>
            <label className="text-sm font-semibold">CLAWD Amount</label>
            <input
              type="number"
              className="input input-bordered w-full"
              placeholder="0.0"
              value={clawdInput}
              onChange={e => {
                setClawdInput(e.target.value);
                setLastEdited("clawd");
                recalc("clawd", wethInput, e.target.value);
              }}
            />
            {clawdInput && parseFloat(clawdInput) > 0 && clawdUsdCurrent > 0 && (
              <p className="text-xs opacity-50 mt-1 ml-1">
                ≈ ${(parseFloat(clawdInput) * clawdUsdCurrent).toFixed(2)} USD
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          {!connectedAddress ? (
            <p className="text-center text-sm opacity-60">Connect wallet to add liquidity</p>
          ) : needWethApproval ? (
            <button
              className="btn btn-primary btn-block"
              disabled={wethMining}
              onClick={async () => {
                await writeWeth({ functionName: "approve", args: [NPM_ADDRESS, wethAmountBn] });
              }}
            >
              {wethMining && <span className="loading loading-spinner loading-sm mr-2" />}
              {wethMining ? "Approving..." : "Approve WETH"}
            </button>
          ) : needClawdApproval ? (
            <button
              className="btn btn-primary btn-block"
              disabled={clawdMining}
              onClick={async () => {
                await writeClawd({ functionName: "approve", args: [NPM_ADDRESS, clawdAmountBn] });
              }}
            >
              {clawdMining && <span className="loading loading-spinner loading-sm mr-2" />}
              {clawdMining ? "Approving..." : "Approve CLAWD"}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-block"
              disabled={npmMining || wethAmountBn === 0n}
              onClick={async () => {
                if (!connectedAddress) return;
                await writeNPM({
                  functionName: "mint",
                  args: [
                    {
                      token0: WETH_ADDRESS,
                      token1: CLAWD_ADDRESS,
                      fee: 10000,
                      tickLower,
                      tickUpper,
                      amount0Desired: wethAmountBn,
                      amount1Desired: clawdAmountBn,
                      amount0Min: (wethAmountBn * 95n) / 100n,
                      amount1Min: (clawdAmountBn * 95n) / 100n,
                      recipient: connectedAddress,
                      deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
                    },
                  ],
                });
              }}
            >
              {npmMining && <span className="loading loading-spinner loading-sm mr-2" />}
              {npmMining ? "Adding Liquidity..." : "Add Liquidity"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
