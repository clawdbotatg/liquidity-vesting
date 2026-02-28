"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import { formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { useAccount, useSimulateContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useReadContract } from "wagmi";
import { WalletBalances } from "~~/components/WalletBalances";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import externalContracts from "~~/contracts/externalContracts";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

const WETH_ADDRESS = externalContracts[8453].WETH.address;
const CLAWD_ADDRESS = externalContracts[8453].CLAWD.address;
const WETH_ABI = externalContracts[8453].WETH.abi;
const CLAWD_ABI = externalContracts[8453].CLAWD.abi;

/* ── Form cache (5 min TTL) ── */
const FORM_CACHE_KEY = "lv_form_v1";
const FORM_CACHE_TTL = 5 * 60 * 1000;

type FormCache = {
  tickLower: number;
  tickUpper: number;
  lpWethInput: string;
  lpClawdInput: string;
  vestDays: number;
  ts: number;
};

function loadFormCache(): FormCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FORM_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as FormCache;
    if (Date.now() - data.ts > FORM_CACHE_TTL) {
      localStorage.removeItem(FORM_CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveFormCache(v: Omit<FormCache, "ts">) {
  try {
    localStorage.setItem(FORM_CACHE_KEY, JSON.stringify({ ...v, ts: Date.now() }));
  } catch {}
}

/* ── LP helpers ── */
const TICK_SPACING = 200;
const TRACK_HALF_STEPS = 200;

function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
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
  return `${ratio.toFixed(2)}x`;
}

// Convert a Uniswap V3 tick to sqrtPriceX96 as bigint
function tickToSqrtPriceX96(tick: number): bigint {
  const sqrtPrice = Math.sqrt(Math.pow(1.0001, tick));
  return BigInt(Math.floor(sqrtPrice * 2 ** 96));
}

// Uniswap V3 LiquidityAmounts: compute token amounts for a given liquidity
// Returns [amount0 (WETH), amount1 (CLAWD)]
function getAmountsForLiquidity(
  sqrtPriceX96: bigint,
  tickLowerPos: number,
  tickUpperPos: number,
  liquidity: bigint,
): [bigint, bigint] {
  if (liquidity === 0n) return [0n, 0n];
  const Q96 = 2n ** 96n;
  const sqrtLower = tickToSqrtPriceX96(tickLowerPos);
  const sqrtUpper = tickToSqrtPriceX96(tickUpperPos);

  if (sqrtPriceX96 <= sqrtLower) {
    // Current price below range: all token0
    return [(liquidity * (sqrtUpper - sqrtLower) * Q96) / sqrtLower / sqrtUpper, 0n];
  } else if (sqrtPriceX96 < sqrtUpper) {
    // Current price in range
    const amount0 = (liquidity * (sqrtUpper - sqrtPriceX96) * Q96) / sqrtPriceX96 / sqrtUpper;
    const amount1 = (liquidity * (sqrtPriceX96 - sqrtLower)) / Q96;
    return [amount0, amount1];
  } else {
    // Current price above range: all token1
    return [0n, (liquidity * (sqrtUpper - sqrtLower)) / Q96];
  }
}

export default function Home() {
  const { address: connectedAddress, chain, connector } = useAccount();
  const { switchChain } = useSwitchChain();

  const { price: ethPrice } = useFetchNativeCurrencyPrice();

  // Get deployed contract address dynamically
  const { data: deployedContractData } = useDeployedContractInfo({ contractName: "LiquidityVesting" });
  const vestingAddress = deployedContractData?.address;

  // Read contract state
  const { data: isLocked } = useScaffoldReadContract({ contractName: "LiquidityVesting", functionName: "isLocked" });
  const { data: vestedPct } = useScaffoldReadContract({
    contractName: "LiquidityVesting",
    functionName: "vestedPercent",
  });
  const { data: lockStart } = useScaffoldReadContract({ contractName: "LiquidityVesting", functionName: "lockStart" });
  const { data: vestDuration } = useScaffoldReadContract({
    contractName: "LiquidityVesting",
    functionName: "vestDuration",
  });
  const { data: contractOwner } = useScaffoldReadContract({ contractName: "LiquidityVesting", functionName: "owner" });
  const { data: vestedLiquidityData } = useScaffoldReadContract({
    contractName: "LiquidityVesting",
    functionName: "vestedLiquidity",
    watch: true,
  });
  const { data: initialLiquidityData } = useScaffoldReadContract({
    contractName: "LiquidityVesting",
    functionName: "initialLiquidity",
    watch: true,
  });

  // Preview reads
  const vestingAbi = deployedContractData?.abi;
  const { data: claimSimulation } = useSimulateContract({
    address: vestingAddress,
    abi: vestingAbi,
    functionName: "claim",
    account: contractOwner as `0x${string}` | undefined,
    query: { enabled: !!isLocked && !!contractOwner && !!vestingAddress && !!vestingAbi },
  });
  const previewClaimData = claimSimulation?.result as [bigint, bigint] | undefined;

  // previewVest contract view removed — replaced by local previewVestAmounts computation

  const { writeContractAsync: writeClaim, isMining: claimMining } = useScaffoldWriteContract({
    contractName: "LiquidityVesting",
  });
  const { writeContractAsync: writeVest, isMining: vestMining } = useScaffoldWriteContract({
    contractName: "LiquidityVesting",
  });
  const { writeContractAsync: writeClaimAndVest, isMining: claimAndVestMining } = useScaffoldWriteContract({
    contractName: "LiquidityVesting",
  });

  // Mobile deep linking
  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile || window.ethereum) return;

    const allIds = [
      connector?.id,
      connector?.name,
      typeof localStorage !== "undefined" ? localStorage.getItem("wagmi.recentConnectorId") : null,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    let wcWallet = "";
    try {
      if (typeof localStorage !== "undefined") {
        const wcKey = Object.keys(localStorage).find(k => k.startsWith("wc@2:client"));
        if (wcKey) wcWallet = (localStorage.getItem(wcKey) || "").toLowerCase();
      }
    } catch {}
    const search = `${allIds} ${wcWallet}`;

    const schemes: [string[], string][] = [
      [["rainbow"], "rainbow://"],
      [["metamask"], "metamask://"],
      [["coinbase", "cbwallet"], "cbwallet://"],
      [["trust"], "trust://"],
      [["phantom"], "phantom://"],
    ];

    for (const [keywords, scheme] of schemes) {
      if (keywords.some(k => search.includes(k))) {
        window.location.href = scheme;
        return;
      }
    }
  }, [connector]);

  const writeAndOpen = useCallback(
    <T,>(writeFn: () => Promise<T>): Promise<T> => {
      const promise = writeFn();
      setTimeout(openWallet, 2000);
      return promise;
    },
    [openWallet],
  );

  const vestedPercentNum = vestedPct ? Number(vestedPct) / 1e16 : 0; // 0-100

  const vestedLiq = vestedLiquidityData ? BigInt(vestedLiquidityData.toString()) : 0n;
  const initialLiq = initialLiquidityData ? BigInt(initialLiquidityData.toString()) : 0n;
  const alreadyWithdrawnPct = initialLiq > 0n ? Number((vestedLiq * 10000n) / initialLiq) / 100 : 0;
  const availableNowPct = Math.max(0, vestedPercentNum - alreadyWithdrawnPct);
  const totalVestedPct = alreadyWithdrawnPct + availableNowPct;

  const isWrongNetwork = connectedAddress && chain?.id !== 8453;

  const timeRemaining = () => {
    if (!lockStart || !vestDuration || !isLocked) return "N/A";
    const now = Math.floor(Date.now() / 1000);
    const end = Number(lockStart) + Number(vestDuration);
    const remaining = end - now;
    if (remaining <= 0) return "Fully vested";
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  };

  const isOwner =
    connectedAddress && contractOwner && connectedAddress.toLowerCase() === (contractOwner as string).toLowerCase();

  // Uniswap V3 Position Manager (Base)
  const POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1" as const;

  const POSITIONS_ABI = [
    {
      name: "positions",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "tokenId", type: "uint256" }],
      outputs: [
        { name: "nonce", type: "uint96" },
        { name: "operator", type: "address" },
        { name: "token0", type: "address" },
        { name: "token1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickLower", type: "int24" },
        { name: "tickUpper", type: "int24" },
        { name: "liquidity", type: "uint128" },
        { name: "feeGrowthInside0LastX128", type: "uint256" },
        { name: "feeGrowthInside1LastX128", type: "uint256" },
        { name: "tokensOwed0", type: "uint128" },
        { name: "tokensOwed1", type: "uint128" },
      ],
    },
  ] as const;

  const SLOT0_ABI = [
    {
      name: "slot0",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [
        { name: "sqrtPriceX96", type: "uint160" },
        { name: "tick", type: "int24" },
        { name: "observationIndex", type: "uint16" },
        { name: "observationCardinality", type: "uint16" },
        { name: "observationCardinalityNext", type: "uint16" },
        { name: "feeProtocol", type: "uint8" },
        { name: "unlocked", type: "bool" },
      ],
    },
  ] as const;

  // Read tokenId from the vesting contract
  const { data: positionTokenId } = useScaffoldReadContract({
    contractName: "LiquidityVesting",
    functionName: "tokenId",
    watch: true,
  });

  // Read live position liquidity from Uniswap NFT manager
  const { data: positionData } = useReadContract({
    address: POSITION_MANAGER,
    abi: POSITIONS_ABI,
    functionName: "positions",
    args: [positionTokenId as bigint],
    query: { enabled: !!positionTokenId && (positionTokenId as bigint) > 0n && !!isLocked },
  });

  // Read current pool price
  const POOL_ADDRESS = "0xCD55381a53da35Ab1D7Bc5e3fE5F76cac976FAc3" as const;

  // Always fetch slot0 — needed for lock-up form ratio even before locking
  const { data: slot0Data } = useReadContract({
    address: POOL_ADDRESS,
    abi: SLOT0_ABI,
    functionName: "slot0",
    query: { refetchInterval: 20_000 },
  });
  // Use sqrtPriceX96 for spot CLAWD price — pool balanceOf() ratios are NOT spot price
  // (pool holds liquidity across all ticks, not just the current tick)
  const clawdUsdPrice =
    slot0Data && ethPrice
      ? (() => {
          const sqrtPriceX96 = slot0Data[0] as bigint;
          const Q96 = 2n ** 96n;
          const SCALE = 10n ** 18n;
          const ratioScaled = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / (Q96 * Q96);
          const clawdPerWeth = Number(ratioScaled) / 1e18;
          return clawdPerWeth > 0 ? ethPrice / clawdPerWeth : 0;
        })()
      : 0;

  // Compute locked token amounts from position liquidity + current price (tick-aware)
  let lockedWeth: bigint | null = null;
  let lockedClawd: bigint | null = null;
  if (positionData && slot0Data) {
    const liquidity = positionData[7] as bigint;
    const sqrtPriceX96 = slot0Data[0] as bigint;
    const tickLowerPos = positionData[5] as number;
    const tickUpperPos = positionData[6] as number;
    if (liquidity > 0n && sqrtPriceX96 > 0n) {
      const [w, c] = getAmountsForLiquidity(sqrtPriceX96, tickLowerPos, tickUpperPos, liquidity);
      lockedWeth = w;
      lockedClawd = c;
    }
  }

  // Compute previewVest amounts using proper LiquidityAmounts math
  // Replaces the broken previewVest() contract view which uses wrong pool-ratio formula
  const previewVestAmounts: [bigint, bigint] | null = (() => {
    if (!isLocked || !positionData || !slot0Data || !vestedPct || !initialLiquidityData) return null;
    const sqrtPriceX96 = slot0Data[0] as bigint;
    const tickLowerPos = positionData[5] as number;
    const tickUpperPos = positionData[6] as number;
    const vestedPctBn = BigInt(vestedPct.toString());
    const totalVestedLiq = (vestedPctBn * initialLiq) / BigInt(1e18);
    const toLiquidate = totalVestedLiq > vestedLiq ? totalVestedLiq - vestedLiq : 0n;
    if (toLiquidate === 0n) return null;
    return getAmountsForLiquidity(sqrtPriceX96, tickLowerPos, tickUpperPos, toLiquidate);
  })();

  // CLAWD per WETH ratio from sqrtPriceX96 — correct way for V3 full-range positions
  // price = (sqrtPriceX96 / 2^96)^2 = CLAWD per WETH (both 18 decimals, WETH=token0)
  const poolRatio = slot0Data
    ? (() => {
        const sqrtPriceX96 = slot0Data[0] as bigint;
        const Q96 = 2n ** 96n;
        const SCALE = 10n ** 18n;
        const ratioScaled = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / (Q96 * Q96);
        return Number(ratioScaled) / 1e18;
      })()
    : null;

  /* ── LP Section state & hooks ── */
  const clawdPerWeth: number = poolRatio ?? 0;
  const sqrtPriceCurrent = slot0Data ? Number(slot0Data[0] as bigint) / 2 ** 96 : 0;
  const clawdUsdCurrent = clawdPerWeth > 0 && ethPrice ? ethPrice / clawdPerWeth : 0;
  const lpCurrentTick =
    clawdPerWeth > 0
      ? Math.round(Math.floor(Math.log(clawdPerWeth) / Math.log(1.0001)) / TICK_SPACING) * TICK_SPACING
      : 0;

  const [tickLower, setTickLower] = useState(() => loadFormCache()?.tickLower ?? 0);
  const [tickUpper, setTickUpper] = useState(() => loadFormCache()?.tickUpper ?? 0);
  const [lpWethInput, setLpWethInput] = useState(() => loadFormCache()?.lpWethInput ?? "");
  const [lpClawdInput, setLpClawdInput] = useState(() => loadFormCache()?.lpClawdInput ?? "");
  const [lpLastEdited, setLpLastEdited] = useState<"weth" | "clawd">("weth");
  const [vestDays, setVestDays] = useState(() => loadFormCache()?.vestDays ?? 30);

  useEffect(() => {
    if (lpCurrentTick !== 0 && tickLower === 0 && tickUpper === 0) {
      setTickLower(lpCurrentTick - 50 * TICK_SPACING);
      setTickUpper(lpCurrentTick + 50 * TICK_SPACING);
    }
  }, [lpCurrentTick, tickLower, tickUpper]);

  const trackMin = lpCurrentTick - TRACK_HALF_STEPS * TICK_SPACING;
  const trackMax = lpCurrentTick + TRACK_HALF_STEPS * TICK_SPACING;
  const tickToPct = (tick: number) =>
    Math.max(0, Math.min(100, 100 - ((tick - trackMin) / (trackMax - trackMin)) * 100));
  const pctToTick = (pct: number) => {
    const raw = trackMin + ((100 - pct) / 100) * (trackMax - trackMin);
    return Math.round(raw / TICK_SPACING) * TICK_SPACING;
  };
  const leftPct = tickToPct(tickUpper);
  const rightPct = tickToPct(tickLower);
  const currentPct = tickToPct(lpCurrentTick);
  const trackRef = useRef<HTMLDivElement>(null);
  const getPct = useCallback((e: React.PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  }, []);

  const lpRecalc = useCallback(
    (edited: "weth" | "clawd", wVal: string, cVal: string) => {
      if (!sqrtPriceCurrent) return;
      const spL = sqrtPriceFromTick(tickLower);
      const spU = sqrtPriceFromTick(tickUpper);
      if (edited === "weth" && wVal) {
        const w = parseFloat(wVal);
        if (!isNaN(w) && w > 0) {
          const c = wethToClawd(w, sqrtPriceCurrent, spL, spU);
          setLpClawdInput(c > 0 ? c.toFixed(2) : "0");
        }
      } else if (edited === "clawd" && cVal) {
        const c = parseFloat(cVal);
        if (!isNaN(c) && c > 0) {
          const w = clawdToWeth(c, sqrtPriceCurrent, spL, spU);
          setLpWethInput(w > 0 ? w.toFixed(8) : "0");
        }
      }
    },
    [sqrtPriceCurrent, tickLower, tickUpper],
  );

  useEffect(() => {
    lpRecalc(lpLastEdited, lpWethInput, lpClawdInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickLower, tickUpper]);

  // Auto-save form state to localStorage (5-min TTL)
  useEffect(() => {
    if (tickLower !== 0 || tickUpper !== 0 || lpWethInput || lpClawdInput) {
      saveFormCache({ tickLower, tickUpper, lpWethInput, lpClawdInput, vestDays });
    }
  }, [tickLower, tickUpper, lpWethInput, lpClawdInput, vestDays]);

  const resetForm = () => {
    localStorage.removeItem(FORM_CACHE_KEY);
    setTickLower(0);
    setTickUpper(0);
    setLpWethInput("");
    setLpClawdInput("");
    setVestDays(30);
  };

  // NPM hooks removed — owner uses lockUp flow instead

  // Vesting contract allowance reads
  const wethNeeded = parseEther(lpWethInput || "0");
  const clawdNeeded = parseEther(lpClawdInput || "0");

  const { data: wethVestAllowance, refetch: refetchWethVestAllowance } = useReadContract({
    address: WETH_ADDRESS,
    abi: WETH_ABI,
    functionName: "allowance",
    args: [connectedAddress!, vestingAddress!],
    query: { enabled: !!connectedAddress && !!vestingAddress },
  });
  const { data: clawdVestAllowance, refetch: refetchClawdVestAllowance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: CLAWD_ABI,
    functionName: "allowance",
    args: [connectedAddress!, vestingAddress!],
    query: { enabled: !!connectedAddress && !!vestingAddress },
  });

  const wethVestApproved =
    wethVestAllowance !== undefined && (wethVestAllowance as bigint) >= wethNeeded && wethNeeded > 0n;
  const clawdVestApproved =
    clawdVestAllowance !== undefined && (clawdVestAllowance as bigint) >= clawdNeeded && clawdNeeded > 0n;

  const { writeContract: approveWethVest, data: approveWethHash } = useWriteContract();
  const { isSuccess: wethApproveConfirmed } = useWaitForTransactionReceipt({ hash: approveWethHash });
  const { writeContract: approveClawdVest, data: approveClawdHash } = useWriteContract();
  const { isSuccess: clawdApproveConfirmed } = useWaitForTransactionReceipt({ hash: approveClawdHash });

  useEffect(() => {
    if (wethApproveConfirmed) refetchWethVestAllowance();
  }, [wethApproveConfirmed, refetchWethVestAllowance]);
  useEffect(() => {
    if (clawdApproveConfirmed) refetchClawdVestAllowance();
  }, [clawdApproveConfirmed, refetchClawdVestAllowance]);

  const { writeContractAsync: writeLockUp, isMining: lockUpMining } = useScaffoldWriteContract({
    contractName: "LiquidityVesting",
  });

  const usd = (amount: bigint | undefined, pricePerToken: number): string => {
    if (!amount || !pricePerToken) return "";
    const val = Number(formatEther(amount)) * pricePerToken;
    if (val < 0.01) return `($${val.toFixed(4)})`;
    return `($${val.toFixed(2)})`;
  };

  const fmtWETH = (wei: bigint): string => Number(formatEther(wei)).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");

  return (
    <div className="flex items-center flex-col flex-grow pt-10">
      <WalletBalances />
      <div className="px-5 w-full max-w-2xl">
        {/* Status Panel */}
        <div className="bg-base-200 rounded-xl p-6 mt-8">
          <h2 className="text-xl font-bold mb-4">📊 Status</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm opacity-60">Locked</span>
              <p className="font-bold">{isLocked ? "✅ Yes" : "❌ No"}</p>
            </div>
            <div>
              <span className="text-sm opacity-60">Time Remaining</span>
              <p className="font-bold">{timeRemaining()}</p>
            </div>
          </div>

          {/* Locked in Pool */}
          {isLocked && (
            <div className="mt-4 pt-4 border-t border-base-300">
              <p className="text-sm opacity-60 mb-2">🔒 Locked in Pool</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm opacity-60">WETH</span>
                  <p className="font-bold">
                    {lockedWeth !== null ? fmtWETH(lockedWeth) : "—"}
                    {lockedWeth !== null && ethPrice ? (
                      <span className="text-xs opacity-50 ml-1">
                        (${(Number(formatEther(lockedWeth)) * ethPrice).toFixed(2)})
                      </span>
                    ) : null}
                  </p>
                </div>
                <div>
                  <span className="text-sm opacity-60">CLAWD</span>
                  <p className="font-bold">
                    {lockedClawd !== null
                      ? Number(formatEther(lockedClawd)).toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : "—"}
                    {lockedClawd !== null && clawdUsdPrice > 0 ? (
                      <span className="text-xs opacity-50 ml-1">
                        (${(Number(formatEther(lockedClawd)) * clawdUsdPrice).toFixed(2)})
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
            </div>
          )}

          {isLocked && (
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">Vested</span>
                <span className="text-base-content/70">{totalVestedPct.toFixed(2)}% total</span>
              </div>
              <div className="w-full bg-base-300 rounded-full h-4 overflow-hidden flex">
                <div
                  className="bg-base-content/40 h-full transition-all duration-500"
                  style={{ width: `${alreadyWithdrawnPct}%` }}
                  title={`${alreadyWithdrawnPct.toFixed(2)}% already withdrawn`}
                />
                <div
                  className="bg-success h-full transition-all duration-500"
                  style={{ width: `${availableNowPct}%` }}
                  title={`${availableNowPct.toFixed(2)}% available to withdraw now`}
                />
              </div>
              <div className="flex justify-between text-xs text-base-content/50 mt-1">
                <span>⬛ {alreadyWithdrawnPct.toFixed(2)}% withdrawn</span>
                <span>🟢 {availableNowPct.toFixed(2)}% available now</span>
              </div>
            </div>
          )}
        </div>

        {/* Wrong network warning */}
        {isWrongNetwork && (
          <div className="bg-warning/20 border border-warning rounded-xl p-6 mt-6 text-center">
            <p className="font-bold text-lg mb-3">⚠️ Wrong Network</p>
            <button className="btn btn-warning btn-sm" onClick={() => switchChain({ chainId: base.id })}>
              Switch to Base
            </button>
          </div>
        )}

        {/* Connect CTA — shown when not connected */}
        {!connectedAddress && (
          <div className="bg-base-200 rounded-xl p-6 mt-6 text-center">
            <p className="text-sm opacity-60 mb-4">Connect your wallet to claim fees and vest liquidity</p>
            <RainbowKitCustomConnectButton />
          </div>
        )}

        {/* Owner display — shown whenever the connected wallet is not the owner (including not connected) */}
        {!isOwner && contractOwner && (
          <div className="bg-base-200 rounded-xl p-6 mt-6 text-center">
            <p className="text-sm opacity-60 mb-2">Owner</p>
            <div className="flex items-center justify-center gap-2">
              <Address address={contractOwner as `0x${string}`} />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {isLocked && isOwner && !isWrongNetwork && (
          <div className="bg-base-200 rounded-xl p-6 mt-6">
            <h2 className="text-xl font-bold mb-4">⚡ Actions</h2>
            <div className="space-y-3">
              <button
                className="btn btn-primary w-full"
                disabled={claimMining}
                onClick={() => writeAndOpen(() => writeClaim({ functionName: "claim" }))}
              >
                {claimMining && <span className="loading loading-spinner loading-sm mr-2" />}
                {claimMining ? "Claiming..." : "💰 Claim Fees"}
              </button>
              {previewClaimData && (
                <p className="text-xs opacity-60 text-center -mt-1">
                  Est: {fmtWETH(previewClaimData[0])} WETH {usd(previewClaimData[0], ethPrice ?? 0)} +{" "}
                  {Number(formatEther(previewClaimData[1])).toFixed(2)} CLAWD {usd(previewClaimData[1], clawdUsdPrice)}{" "}
                  in fees
                </p>
              )}
              <button
                className="btn btn-secondary w-full"
                disabled={vestMining || (availableNowPct > 0 && !previewVestAmounts)}
                onClick={() =>
                  writeAndOpen(() =>
                    writeVest({
                      functionName: "vest",
                      args: [
                        previewVestAmounts ? (previewVestAmounts[0] * 95n) / 100n : 0n,
                        previewVestAmounts ? (previewVestAmounts[1] * 95n) / 100n : 0n,
                      ],
                    }),
                  )
                }
              >
                {vestMining && <span className="loading loading-spinner loading-sm mr-2" />}
                {vestMining ? "Vesting..." : "📤 Vest"}
              </button>
              {previewVestAmounts && (
                <p className="text-xs opacity-60 text-center -mt-1">
                  Est: {fmtWETH(previewVestAmounts[0])} WETH {usd(previewVestAmounts[0], ethPrice ?? 0)} +{" "}
                  {Number(formatEther(previewVestAmounts[1])).toFixed(2)} CLAWD{" "}
                  {usd(previewVestAmounts[1], clawdUsdPrice)} (~
                  {vestedPercentNum.toFixed(1)}% vested)
                </p>
              )}
              <button
                className="btn btn-accent w-full"
                disabled={claimAndVestMining || (availableNowPct > 0 && !previewVestAmounts)}
                onClick={() =>
                  writeAndOpen(() =>
                    writeClaimAndVest({
                      functionName: "claimAndVest",
                      args: [
                        previewVestAmounts ? (previewVestAmounts[0] * 95n) / 100n : 0n,
                        previewVestAmounts ? (previewVestAmounts[1] * 95n) / 100n : 0n,
                      ],
                    }),
                  )
                }
              >
                {claimAndVestMining && <span className="loading loading-spinner loading-sm mr-2" />}
                {claimAndVestMining ? "Processing..." : "🔄 Claim & Vest"}
              </button>
              {(previewClaimData || previewVestAmounts) && (
                <p className="text-xs opacity-60 text-center -mt-1">
                  Est: {fmtWETH((previewClaimData?.[0] ?? 0n) + (previewVestAmounts?.[0] ?? 0n))} WETH{" "}
                  {usd((previewClaimData?.[0] ?? 0n) + (previewVestAmounts?.[0] ?? 0n), ethPrice ?? 0)} +{" "}
                  {Number(formatEther((previewClaimData?.[1] ?? 0n) + (previewVestAmounts?.[1] ?? 0n))).toFixed(2)}{" "}
                  CLAWD {usd((previewClaimData?.[1] ?? 0n) + (previewVestAmounts?.[1] ?? 0n), clawdUsdPrice)} total
                </p>
              )}
            </div>
          </div>
        )}
        {/* LP Section */}
        {isOwner && !isLocked && connectedAddress && !isWrongNetwork && (
          <div className="bg-base-200 rounded-xl p-6 mt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">🔒 Lock Liquidity</h2>
              <button className="btn btn-ghost btn-xs opacity-50 hover:opacity-100" onClick={resetForm}>
                ↺ Reset
              </button>
            </div>

            {/* Current Price */}
            <div className="text-center mb-8">
              <div className="text-xs opacity-50 mb-1">Current CLAWD Price</div>
              <div className="text-2xl font-bold">
                {clawdUsdCurrent > 0 ? fmtClawdUsd(lpCurrentTick, ethPrice ?? 0) : "..."}
              </div>
            </div>

            {/* Dual-handle track */}
            <div className="px-4 mb-12">
              <div ref={trackRef} className="relative h-8 flex items-center select-none">
                <div className="absolute left-0 right-0 h-2 bg-base-300 rounded-full" />
                <div
                  className="absolute h-2 rounded-l-full"
                  style={{ left: `${leftPct}%`, width: `${currentPct - leftPct}%`, backgroundColor: "#fb923c" }}
                />
                <div
                  className="absolute h-2 rounded-r-full"
                  style={{ left: `${currentPct}%`, width: `${rightPct - currentPct}%`, backgroundColor: "#fb923c" }}
                />
                <div
                  className="absolute -translate-x-1/2 pointer-events-none flex flex-col items-center"
                  style={{ left: `${currentPct}%` }}
                >
                  <div className="text-xs opacity-50 mb-1 whitespace-nowrap" style={{ marginTop: "-20px" }}>
                    now
                  </div>
                  <div className="w-0.5 h-6 bg-warning" />
                </div>
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
                    <span>{fmtClawdUsd(tickUpper, ethPrice ?? 0)}</span>
                    <span className="opacity-60 font-normal">{fmtMultiplier(tickUpper, clawdPerWeth)}</span>
                  </div>
                </div>
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
                    <span>{fmtClawdUsd(tickLower, ethPrice ?? 0)}</span>
                    <span className="opacity-60 font-normal">{fmtMultiplier(tickLower, clawdPerWeth)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Range summary */}
            <div className="flex justify-between text-xs mb-6">
              <div>
                <div className="opacity-60">Min price</div>
                <div className="font-bold">{fmtClawdUsd(tickUpper, ethPrice ?? 0)}</div>
                <div className="opacity-60">{fmtMultiplier(tickUpper, clawdPerWeth)} of current</div>
              </div>
              <div className="text-right">
                <div className="opacity-60">Max price</div>
                <div className="font-bold">{fmtClawdUsd(tickLower, ethPrice ?? 0)}</div>
                <div className="opacity-60">{fmtMultiplier(tickLower, clawdPerWeth)} of current</div>
              </div>
            </div>

            {/* Amount Inputs */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-sm font-semibold">WETH Amount</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  placeholder="0.0"
                  value={lpWethInput}
                  onChange={e => {
                    setLpWethInput(e.target.value);
                    setLpLastEdited("weth");
                    lpRecalc("weth", e.target.value, lpClawdInput);
                  }}
                />
                {lpWethInput && parseFloat(lpWethInput) > 0 && ethPrice && ethPrice > 0 && (
                  <p className="text-xs opacity-50 mt-1 ml-1">
                    ≈ ${(parseFloat(lpWethInput) * ethPrice).toFixed(2)} USD
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-semibold">CLAWD Amount</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  placeholder="0.0"
                  value={lpClawdInput}
                  onChange={e => {
                    setLpClawdInput(e.target.value);
                    setLpLastEdited("clawd");
                    lpRecalc("clawd", lpWethInput, e.target.value);
                  }}
                />
                {lpClawdInput && parseFloat(lpClawdInput) > 0 && clawdUsdCurrent > 0 && (
                  <p className="text-xs opacity-50 mt-1 ml-1">
                    ≈ ${(parseFloat(lpClawdInput) * clawdUsdCurrent).toFixed(2)} USD
                  </p>
                )}
              </div>
            </div>

            {/* Vest Duration */}
            <div className="mb-4">
              <label className="label">
                <span className="label-text">Vest Duration</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={vestDays}
                onChange={e => setVestDays(Number(e.target.value))}
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>365 days</option>
              </select>
            </div>

            {/* 3-step lockUp flow */}
            <div className="space-y-2">
              {!wethVestApproved && (
                <button
                  className="btn btn-primary w-full"
                  disabled={wethNeeded === 0n}
                  onClick={() =>
                    approveWethVest({
                      address: WETH_ADDRESS,
                      abi: WETH_ABI,
                      functionName: "approve",
                      args: [vestingAddress!, wethNeeded],
                    })
                  }
                >
                  1️⃣ Approve WETH
                </button>
              )}
              {wethVestApproved && !clawdVestApproved && (
                <button
                  className="btn btn-primary w-full"
                  disabled={clawdNeeded === 0n}
                  onClick={() =>
                    approveClawdVest({
                      address: CLAWD_ADDRESS,
                      abi: CLAWD_ABI,
                      functionName: "approve",
                      args: [vestingAddress!, clawdNeeded],
                    })
                  }
                >
                  2️⃣ Approve CLAWD
                </button>
              )}
              {wethVestApproved && clawdVestApproved && (
                <button
                  className="btn btn-accent w-full"
                  disabled={lockUpMining || tickLower >= tickUpper || wethNeeded === 0n}
                  onClick={() =>
                    writeLockUp({
                      functionName: "lockUp",
                      args: [
                        wethNeeded,
                        clawdNeeded,
                        BigInt(Math.floor(vestDays * 86400)),
                        tickLower,
                        tickUpper,
                        (wethNeeded * 95n) / 100n,
                        (clawdNeeded * 95n) / 100n,
                      ],
                    })
                  }
                >
                  {lockUpMining && <span className="loading loading-spinner loading-sm mr-2" />}
                  {lockUpMining ? "Locking..." : "🔒 Lock into Vesting"}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col items-center mt-8 mb-4 text-sm opacity-60">
          <p className="mb-1">Contract</p>
          {vestingAddress && <Address address={vestingAddress} />}
        </div>
      </div>
    </div>
  );
}
