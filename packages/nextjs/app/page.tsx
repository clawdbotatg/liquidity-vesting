"use client";

import { useCallback, useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import { formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { useAccount, useSimulateContract, useSwitchChain, useWriteContract } from "wagmi";
import { useReadContract } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import externalContracts from "~~/contracts/externalContracts";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useTransactor } from "~~/hooks/scaffold-eth";

const WETH_ABI = externalContracts[8453].WETH.abi;
const CLAWD_ABI = externalContracts[8453].CLAWD.abi;
const WETH_ADDRESS = externalContracts[8453].WETH.address;
const CLAWD_ADDRESS = externalContracts[8453].CLAWD.address;

export default function Home() {
  const { address: connectedAddress, chain, connector } = useAccount();
  const { switchChain } = useSwitchChain();
  const [wethAmount, setWethAmount] = useState("0.001");
  const [clawdAmount, setClawdAmount] = useState("100000");
  const [vestDays, setVestDays] = useState(30);
  const [wethApprovePending, setWethApprovePending] = useState(false);
  const [clawdApprovePending, setClawdApprovePending] = useState(false);

  const { price: ethPrice } = useFetchNativeCurrencyPrice();
  const writeTx = useTransactor();

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

  const { data: previewVestData } = useScaffoldReadContract({
    contractName: "LiquidityVesting",
    functionName: "previewVest",
    watch: true,
  });

  // Token balances
  const { data: wethBalance } = useReadContract({
    address: WETH_ADDRESS,
    abi: WETH_ABI,
    functionName: "balanceOf",
    args: [connectedAddress!],
    query: { enabled: !!connectedAddress },
  });
  const { data: clawdBalance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: CLAWD_ABI,
    functionName: "balanceOf",
    args: [connectedAddress!],
    query: { enabled: !!connectedAddress },
  });

  // Allowances
  const { data: wethAllowance, refetch: refetchWethAllowance } = useReadContract({
    address: WETH_ADDRESS,
    abi: WETH_ABI,
    functionName: "allowance",
    args: [connectedAddress!, vestingAddress!],
    query: { enabled: !!connectedAddress && !!vestingAddress },
  });
  const { data: clawdAllowance, refetch: refetchClawdAllowance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: CLAWD_ABI,
    functionName: "allowance",
    args: [connectedAddress!, vestingAddress!],
    query: { enabled: !!connectedAddress && !!vestingAddress },
  });

  // Write hooks
  const { writeContractAsync: writeWethAsync } = useWriteContract();
  const { writeContractAsync: writeClawdAsync } = useWriteContract();
  const { writeContractAsync: writeLockUp, isMining: lockUpMining } = useScaffoldWriteContract({
    contractName: "LiquidityVesting",
  });
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

  const wethNeeded = parseEther(wethAmount || "0");
  const clawdNeeded = parseEther(clawdAmount || "0");
  const wethApproved = wethAllowance !== undefined && (wethAllowance as bigint) >= wethNeeded;
  const clawdApproved = clawdAllowance !== undefined && (clawdAllowance as bigint) >= clawdNeeded;

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
  });
  const { data: poolWethBal } = useReadContract({
    address: WETH_ADDRESS,
    abi: WETH_ABI,
    functionName: "balanceOf",
    args: [POOL_ADDRESS],
  });
  const { data: poolClawdBal } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: CLAWD_ABI,
    functionName: "balanceOf",
    args: [POOL_ADDRESS],
  });
  const clawdUsdPrice =
    poolWethBal && poolClawdBal && ethPrice && Number(poolClawdBal) > 0
      ? (Number(formatEther(poolWethBal as bigint)) / Number(formatEther(poolClawdBal as bigint))) * ethPrice
      : 0;

  // Compute locked token amounts from position liquidity + current price
  // For full-range: amount0 = liquidity * 2^96 / sqrtPriceX96, amount1 = liquidity * sqrtPriceX96 / 2^96
  let lockedWeth: bigint | null = null;
  let lockedClawd: bigint | null = null;
  if (positionData && slot0Data) {
    const liquidity = positionData[7] as bigint;
    const sqrtPriceX96 = slot0Data[0] as bigint;
    if (liquidity > 0n && sqrtPriceX96 > 0n) {
      const Q96 = 2n ** 96n;
      lockedWeth = (liquidity * Q96) / sqrtPriceX96;
      lockedClawd = (liquidity * sqrtPriceX96) / Q96;
    }
  }

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

  const handleWethChange = (val: string) => {
    setWethAmount(val);
    if (poolRatio && val !== "" && !isNaN(parseFloat(val))) {
      setClawdAmount(Math.round(parseFloat(val) * poolRatio).toString());
    }
  };

  const handleClawdChange = (val: string) => {
    setClawdAmount(val);
    if (poolRatio && val !== "" && !isNaN(parseFloat(val))) {
      setWethAmount((parseFloat(val) / poolRatio).toFixed(6));
    }
  };

  // Once pool ratio loads, sync default CLAWD amount to match default WETH amount
  useEffect(() => {
    if (poolRatio && wethAmount && !isNaN(parseFloat(wethAmount))) {
      setClawdAmount(Math.round(parseFloat(wethAmount) * poolRatio).toString());
    }
    // Only run once when ratio first becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolRatio !== null]);

  const usd = (amount: bigint | undefined, pricePerToken: number): string => {
    if (!amount || !pricePerToken) return "";
    const val = Number(formatEther(amount)) * pricePerToken;
    if (val < 0.01) return `($${val.toFixed(4)})`;
    return `($${val.toFixed(2)})`;
  };

  const fmtWETH = (wei: bigint): string => Number(formatEther(wei)).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");

  const wethBalanceFormatted = wethBalance !== undefined ? Number(formatEther(wethBalance as bigint)).toFixed(6) : null;
  const clawdBalanceFormatted = clawdBalance !== undefined ? formatEther(clawdBalance as bigint) : null;
  const wethUsd =
    wethBalanceFormatted && ethPrice ? `($${(parseFloat(wethBalanceFormatted) * ethPrice).toFixed(2)})` : "";

  return (
    <div className="flex items-center flex-col flex-grow pt-10">
      <div className="px-5 w-full max-w-2xl">
        {connectedAddress && (
          <div className="flex justify-center mt-2 opacity-50 text-sm">
            <span className="mr-1">Connected:</span> <Address address={connectedAddress} />
          </div>
        )}

        {/* Status Panel */}
        <div className="bg-base-200 rounded-xl p-6 mt-8">
          <h2 className="text-xl font-bold mb-4">📊 Status</h2>
          {vestingAddress && (
            <div className="mb-4 text-sm">
              <span className="opacity-60">Contract: </span>
              <Address address={vestingAddress} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm opacity-60">Locked</span>
              <p className="font-bold">{isLocked ? "✅ Yes" : "❌ No"}</p>
            </div>
            <div>
              <span className="text-sm opacity-60">Time Remaining</span>
              <p className="font-bold">{timeRemaining()}</p>
            </div>
            {connectedAddress && (
              <>
                <div>
                  <span className="text-sm opacity-60">Your WETH</span>
                  <p className="font-bold">
                    {wethBalanceFormatted ?? "—"} {wethUsd && <span className="text-xs opacity-50">{wethUsd}</span>}
                  </p>
                </div>
                <div>
                  <span className="text-sm opacity-60">Your CLAWD</span>
                  <p className="font-bold">
                    {clawdBalanceFormatted ? Number(clawdBalanceFormatted).toLocaleString() : "—"}
                    {clawdBalanceFormatted && clawdUsdPrice > 0 && (
                      <span className="text-sm font-normal opacity-70 ml-1">
                        (${(parseFloat(clawdBalanceFormatted) * clawdUsdPrice).toFixed(2)})
                      </span>
                    )}
                  </p>
                </div>
              </>
            )}
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

        {/* LockUp Section */}
        {!isLocked && isOwner && vestingAddress && !isWrongNetwork && (
          <div className="bg-base-200 rounded-xl p-6 mt-6">
            <h2 className="text-xl font-bold mb-4">🔒 Lock Up Liquidity</h2>

            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text">WETH Amount</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={wethAmount}
                  onChange={e => handleWethChange(e.target.value)}
                />
                {ethPrice && wethAmount && (
                  <p className="text-xs opacity-50 mt-1">
                    ≈ ${(parseFloat(wethAmount || "0") * ethPrice).toFixed(2)} USD
                  </p>
                )}
              </div>
              <div>
                <label className="label">
                  <span className="label-text">CLAWD Amount</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={clawdAmount}
                  onChange={e => handleClawdChange(e.target.value)}
                />
                {clawdUsdPrice > 0 && clawdAmount && (
                  <p className="text-xs opacity-50 mt-1">
                    ≈ ${(parseFloat(clawdAmount || "0") * clawdUsdPrice).toFixed(4)} USD
                  </p>
                )}
              </div>
              <div>
                <label className="label">
                  <span className="label-text">Vest Duration (days)</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={vestDays}
                  onChange={e => setVestDays(Number(e.target.value))}
                >
                  <option value={0.00347}>5 min (test)</option>
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>365 days</option>
                </select>
              </div>

              {/* Three-button flow */}
              {!wethApproved && (
                <button
                  className="btn btn-primary w-full"
                  disabled={wethApprovePending}
                  onClick={async () => {
                    setWethApprovePending(true);
                    try {
                      await writeTx(() =>
                        writeAndOpen(() =>
                          writeWethAsync({
                            address: WETH_ADDRESS,
                            abi: WETH_ABI,
                            functionName: "approve",
                            args: [vestingAddress, wethNeeded],
                          }),
                        ),
                      );
                      setTimeout(() => refetchWethAllowance(), 2000);
                    } finally {
                      setWethApprovePending(false);
                    }
                  }}
                >
                  {wethApprovePending && <span className="loading loading-spinner loading-sm mr-2" />}
                  {wethApprovePending ? "Approving WETH..." : `1️⃣ Approve ${wethAmount} WETH`}
                </button>
              )}

              {wethApproved && !clawdApproved && (
                <button
                  className="btn btn-primary w-full"
                  disabled={clawdApprovePending}
                  onClick={async () => {
                    setClawdApprovePending(true);
                    try {
                      await writeTx(() =>
                        writeAndOpen(() =>
                          writeClawdAsync({
                            address: CLAWD_ADDRESS,
                            abi: CLAWD_ABI,
                            functionName: "approve",
                            args: [vestingAddress, clawdNeeded],
                          }),
                        ),
                      );
                      setTimeout(() => refetchClawdAllowance(), 2000);
                    } finally {
                      setClawdApprovePending(false);
                    }
                  }}
                >
                  {clawdApprovePending && <span className="loading loading-spinner loading-sm mr-2" />}
                  {clawdApprovePending ? "Approving CLAWD..." : `2️⃣ Approve ${clawdAmount} CLAWD`}
                </button>
              )}

              {wethApproved && clawdApproved && (
                <button
                  className="btn btn-accent w-full"
                  disabled={lockUpMining}
                  onClick={async () => {
                    await writeAndOpen(() =>
                      writeLockUp({
                        functionName: "lockUp",
                        args: [wethNeeded, clawdNeeded, BigInt(Math.floor(vestDays * 86400)), BigInt(0), BigInt(0)],
                      }),
                    );
                  }}
                >
                  {lockUpMining && <span className="loading loading-spinner loading-sm mr-2" />}
                  {lockUpMining ? "Locking..." : "3️⃣ Lock Up Liquidity"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Connect CTA — shown when not connected */}
        {!connectedAddress && (
          <div className="bg-base-200 rounded-xl p-6 mt-6 text-center">
            <p className="text-sm opacity-60 mb-4">Connect your wallet to claim fees and vest liquidity</p>
            <RainbowKitCustomConnectButton />
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
                disabled={vestMining}
                onClick={() => writeAndOpen(() => writeVest({ functionName: "vest", args: [BigInt(0), BigInt(0)] }))}
              >
                {vestMining && <span className="loading loading-spinner loading-sm mr-2" />}
                {vestMining ? "Vesting..." : "📤 Vest"}
              </button>
              {previewVestData && (
                <p className="text-xs opacity-60 text-center -mt-1">
                  Est: {fmtWETH(previewVestData[0])} WETH {usd(previewVestData[0], ethPrice ?? 0)} +{" "}
                  {Number(formatEther(previewVestData[1])).toFixed(2)} CLAWD {usd(previewVestData[1], clawdUsdPrice)} (~
                  {vestedPercentNum.toFixed(1)}% vested)
                </p>
              )}
              <button
                className="btn btn-accent w-full"
                disabled={claimAndVestMining}
                onClick={() =>
                  writeAndOpen(() => writeClaimAndVest({ functionName: "claimAndVest", args: [BigInt(0), BigInt(0)] }))
                }
              >
                {claimAndVestMining && <span className="loading loading-spinner loading-sm mr-2" />}
                {claimAndVestMining ? "Processing..." : "🔄 Claim & Vest"}
              </button>
              {(previewClaimData || previewVestData) && (
                <p className="text-xs opacity-60 text-center -mt-1">
                  Est: {fmtWETH((previewClaimData?.[0] ?? 0n) + (previewVestData?.[0] ?? 0n))} WETH{" "}
                  {usd((previewClaimData?.[0] ?? 0n) + (previewVestData?.[0] ?? 0n), ethPrice ?? 0)} +{" "}
                  {Number(formatEther((previewClaimData?.[1] ?? 0n) + (previewVestData?.[1] ?? 0n))).toFixed(2)} CLAWD{" "}
                  {usd((previewClaimData?.[1] ?? 0n) + (previewVestData?.[1] ?? 0n), clawdUsdPrice)} total
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
