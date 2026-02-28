"use client";

import { useCallback, useEffect, useState } from "react";
import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const TICK_SPACING = 200;
const NPM_ADDRESS = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";

function priceToTick(price: number): number {
  const rawTick = Math.floor(Math.log(price) / Math.log(1.0001));
  return Math.round(rawTick / TICK_SPACING) * TICK_SPACING;
}

function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

function sqrtPriceFromTick(tick: number): number {
  return Math.sqrt(Math.pow(1.0001, tick));
}

function wethToClawd(
  wethAmount: number,
  sqrtPriceCurrent: number,
  sqrtPriceLower: number,
  sqrtPriceUpper: number,
): number {
  if (sqrtPriceCurrent <= sqrtPriceLower) return 0;
  const sp = Math.min(sqrtPriceCurrent, sqrtPriceUpper);
  const L = (wethAmount * sp * sqrtPriceUpper) / (sqrtPriceUpper - sp);
  return L * (sp - sqrtPriceLower);
}

function clawdToWeth(
  clawdAmount: number,
  sqrtPriceCurrent: number,
  sqrtPriceLower: number,
  sqrtPriceUpper: number,
): number {
  if (sqrtPriceCurrent >= sqrtPriceUpper) return 0;
  const sp = Math.max(sqrtPriceCurrent, sqrtPriceLower);
  const L = clawdAmount / (sp - sqrtPriceLower);
  return (L * (sqrtPriceUpper - sp)) / (sp * sqrtPriceUpper);
}

export default function LPPage() {
  const { address: connectedAddress } = useAccount();

  const { data: slot0 } = useScaffoldReadContract({
    contractName: "UniswapV3Pool",
    functionName: "slot0",
  });

  const sqrtPriceX96 = slot0?.[0];
  const sqrtPriceCurrent = sqrtPriceX96 ? Number(sqrtPriceX96) / 2 ** 96 : 0;
  const currentPrice = sqrtPriceCurrent * sqrtPriceCurrent;

  const [tickLower, setTickLower] = useState<number>(0);
  const [tickUpper, setTickUpper] = useState<number>(0);
  const [wethInput, setWethInput] = useState("");
  const [clawdInput, setClawdInput] = useState("");
  const [lastEdited, setLastEdited] = useState<"weth" | "clawd">("weth");
  const [successMsg, setSuccessMsg] = useState("");

  // Initialize ticks when price loads
  useEffect(() => {
    if (currentPrice > 0 && tickLower === 0 && tickUpper === 0) {
      setTickLower(priceToTick(currentPrice * 0.5));
      setTickUpper(priceToTick(currentPrice * 2.5));
    }
  }, [currentPrice, tickLower, tickUpper]);

  const sliderMin = currentPrice > 0 ? priceToTick(currentPrice * 0.05) : -200000;
  const sliderMax = currentPrice > 0 ? priceToTick(currentPrice * 20) : 200000;

  // Recalculate amounts when ticks or inputs change
  const recalc = useCallback(
    (edited: "weth" | "clawd", wVal: string, cVal: string) => {
      if (sqrtPriceCurrent === 0) return;
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

  // Allowance reads
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

  const { writeContractAsync: writeWeth } = useScaffoldWriteContract("WETH");
  const { writeContractAsync: writeClawd } = useScaffoldWriteContract("CLAWD");
  const { writeContractAsync: writeNPM } = useScaffoldWriteContract("NonfungiblePositionManager");

  const wethAmountBn = wethInput ? parseUnits(wethInput, 18) : 0n;
  const clawdAmountBn = clawdInput ? parseUnits(clawdInput, 18) : 0n;

  const needWethApproval = wethAllowance !== undefined && wethAmountBn > 0n && wethAllowance < wethAmountBn;
  const needClawdApproval = clawdAllowance !== undefined && clawdAmountBn > 0n && clawdAllowance < clawdAmountBn;

  const handleApproveWeth = async () => {
    await writeWeth({ functionName: "approve", args: [NPM_ADDRESS, wethAmountBn] });
  };

  const handleApproveClawd = async () => {
    await writeClawd({ functionName: "approve", args: [NPM_ADDRESS, clawdAmountBn] });
  };

  const handleMint = async () => {
    if (!connectedAddress) return;
    const result = await writeNPM({
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
    setSuccessMsg(`✅ Position created! TX: ${result}`);
  };

  return (
    <div className="flex flex-col items-center pt-10 px-4">
      <h1 className="text-4xl font-bold mb-8" style={{ color: "#e8481a" }}>
        🦞 Add Liquidity
      </h1>

      <div className="w-full max-w-lg space-y-6">
        {/* Current Price */}
        <div className="bg-base-200 rounded-xl p-4 text-center">
          <div className="text-sm opacity-70">Current Price</div>
          <div className="text-2xl font-bold">{currentPrice > 0 ? currentPrice.toFixed(2) : "..."} CLAWD per WETH</div>
        </div>

        {/* Range Sliders */}
        <div className="bg-base-200 rounded-xl p-4 space-y-4">
          <div>
            <label className="text-sm font-semibold">Lower Price: {tickToPrice(tickLower).toFixed(2)} CLAWD/WETH</label>
            <div className="text-xs opacity-50">tick: {tickLower}</div>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={TICK_SPACING}
              value={tickLower}
              onChange={e => {
                const v = Number(e.target.value);
                if (v < tickUpper) setTickLower(v);
              }}
              className="range w-full"
              style={{ accentColor: "#e8481a" }}
            />
          </div>
          <div>
            <label className="text-sm font-semibold">Upper Price: {tickToPrice(tickUpper).toFixed(2)} CLAWD/WETH</label>
            <div className="text-xs opacity-50">tick: {tickUpper}</div>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={TICK_SPACING}
              value={tickUpper}
              onChange={e => {
                const v = Number(e.target.value);
                if (v > tickLower) setTickUpper(v);
              }}
              className="range w-full"
              style={{ accentColor: "#e8481a" }}
            />
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
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          {needWethApproval && (
            <button
              className="btn btn-block"
              style={{ backgroundColor: "#e8481a", color: "white" }}
              onClick={handleApproveWeth}
            >
              Approve WETH
            </button>
          )}
          {needClawdApproval && (
            <button
              className="btn btn-block"
              style={{ backgroundColor: "#e8481a", color: "white" }}
              onClick={handleApproveClawd}
            >
              Approve CLAWD
            </button>
          )}
          {!needWethApproval && !needClawdApproval && (
            <button
              className="btn btn-block"
              style={{ backgroundColor: "#e8481a", color: "white" }}
              disabled={!connectedAddress || wethAmountBn === 0n}
              onClick={handleMint}
            >
              Add Liquidity
            </button>
          )}
        </div>

        {successMsg && (
          <div className="bg-success/20 rounded-xl p-4 text-center text-success font-bold">{successMsg}</div>
        )}
      </div>
    </div>
  );
}
