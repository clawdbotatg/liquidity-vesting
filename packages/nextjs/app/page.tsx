"use client";

import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import externalContracts from "~~/contracts/externalContracts";
import deployedContracts from "~~/contracts/deployedContracts";

const VESTING_ADDRESS = deployedContracts[8453].LiquidityVesting.address;
const WETH_ABI = externalContracts[8453].WETH.abi;
const CLAWD_ABI = externalContracts[8453].CLAWD.abi;
const WETH_ADDRESS = externalContracts[8453].WETH.address;
const CLAWD_ADDRESS = externalContracts[8453].CLAWD.address;

export default function Home() {
  const { address: connectedAddress } = useAccount();
  const [wethAmount, setWethAmount] = useState("0.001");
  const [clawdAmount, setClawdAmount] = useState("100000");
  const [vestDays, setVestDays] = useState(30);

  // Read contract state
  const { data: isLocked } = useScaffoldReadContract({ contractName: "LiquidityVesting", functionName: "isLocked" });
  const { data: vestedPct } = useScaffoldReadContract({ contractName: "LiquidityVesting", functionName: "vestedPercent" });
  const { data: lockStart } = useScaffoldReadContract({ contractName: "LiquidityVesting", functionName: "lockStart" });
  const { data: vestDuration } = useScaffoldReadContract({ contractName: "LiquidityVesting", functionName: "vestDuration" });
  const { data: contractOwner } = useScaffoldReadContract({ contractName: "LiquidityVesting", functionName: "owner" });

  // Token balances
  const { data: wethBalance } = useReadContract({
    address: WETH_ADDRESS, abi: WETH_ABI, functionName: "balanceOf", args: [connectedAddress!],
    query: { enabled: !!connectedAddress },
  });
  const { data: clawdBalance } = useReadContract({
    address: CLAWD_ADDRESS, abi: CLAWD_ABI, functionName: "balanceOf", args: [connectedAddress!],
    query: { enabled: !!connectedAddress },
  });

  // Allowances
  const { data: wethAllowance, refetch: refetchWethAllowance } = useReadContract({
    address: WETH_ADDRESS, abi: WETH_ABI, functionName: "allowance",
    args: [connectedAddress!, VESTING_ADDRESS],
    query: { enabled: !!connectedAddress },
  });
  const { data: clawdAllowance, refetch: refetchClawdAllowance } = useReadContract({
    address: CLAWD_ADDRESS, abi: CLAWD_ABI, functionName: "allowance",
    args: [connectedAddress!, VESTING_ADDRESS],
    query: { enabled: !!connectedAddress },
  });

  // Write hooks
  const { writeContractAsync: writeWeth, isPending: wethApprovePending } = useWriteContract();
  const { writeContractAsync: writeClawd, isPending: clawdApprovePending } = useWriteContract();
  const { writeContractAsync: writeLockUp, isMining: lockUpMining } = useScaffoldWriteContract("LiquidityVesting");
  const { writeContractAsync: writeClaim, isMining: claimMining } = useScaffoldWriteContract("LiquidityVesting");
  const { writeContractAsync: writeVest, isMining: vestMining } = useScaffoldWriteContract("LiquidityVesting");
  const { writeContractAsync: writeClaimAndVest, isMining: claimAndVestMining } = useScaffoldWriteContract("LiquidityVesting");

  const wethNeeded = parseEther(wethAmount || "0");
  const clawdNeeded = parseEther(clawdAmount || "0");
  const wethApproved = wethAllowance !== undefined && (wethAllowance as bigint) >= wethNeeded;
  const clawdApproved = clawdAllowance !== undefined && (clawdAllowance as bigint) >= clawdNeeded;

  const vestedPercentNum = vestedPct ? Number(vestedPct) / 1e16 : 0; // 0-100

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

  const isOwner = connectedAddress && contractOwner && connectedAddress.toLowerCase() === contractOwner.toLowerCase();

  return (
    <div className="flex items-center flex-col flex-grow pt-10">
      <div className="px-5 w-full max-w-2xl">
        <h1 className="text-center">
          <span className="block text-4xl font-bold mb-2">🦞 Liquidity Vesting</span>
          <span className="block text-sm opacity-70">WETH / CLAWD · Uniswap V3 · Base</span>
        </h1>

        {connectedAddress && (
          <p className="text-center text-sm mt-2 opacity-50">
            Connected: {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
          </p>
        )}

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
            <div>
              <span className="text-sm opacity-60">WETH Balance</span>
              <p className="font-bold">{wethBalance !== undefined ? Number(formatEther(wethBalance as bigint)).toFixed(6) : "—"}</p>
            </div>
            <div>
              <span className="text-sm opacity-60">CLAWD Balance</span>
              <p className="font-bold">{clawdBalance !== undefined ? Number(formatEther(clawdBalance as bigint)).toLocaleString() : "—"}</p>
            </div>
          </div>

          {isLocked && (
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span>Vested</span>
                <span>{vestedPercentNum.toFixed(2)}%</span>
              </div>
              <div className="w-full bg-base-300 rounded-full h-4">
                <div
                  className="bg-primary h-4 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(vestedPercentNum, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* LockUp Section */}
        {!isLocked && isOwner && (
          <div className="bg-base-200 rounded-xl p-6 mt-6">
            <h2 className="text-xl font-bold mb-4">🔒 Lock Up Liquidity</h2>

            <div className="space-y-4">
              <div>
                <label className="label"><span className="label-text">WETH Amount</span></label>
                <input
                  type="text" className="input input-bordered w-full"
                  value={wethAmount} onChange={e => setWethAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="label"><span className="label-text">CLAWD Amount</span></label>
                <input
                  type="text" className="input input-bordered w-full"
                  value={clawdAmount} onChange={e => setClawdAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="label"><span className="label-text">Vest Duration (days)</span></label>
                <select className="select select-bordered w-full" value={vestDays} onChange={e => setVestDays(Number(e.target.value))}>
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
                  className={`btn btn-primary w-full ${wethApprovePending ? "loading" : ""}`}
                  disabled={wethApprovePending}
                  onClick={async () => {
                    await writeWeth({
                      address: WETH_ADDRESS, abi: WETH_ABI, functionName: "approve",
                      args: [VESTING_ADDRESS, wethNeeded],
                    });
                    setTimeout(() => refetchWethAllowance(), 2000);
                  }}
                >
                  {wethApprovePending ? "Approving WETH..." : `1️⃣ Approve ${wethAmount} WETH`}
                </button>
              )}

              {wethApproved && !clawdApproved && (
                <button
                  className={`btn btn-primary w-full ${clawdApprovePending ? "loading" : ""}`}
                  disabled={clawdApprovePending}
                  onClick={async () => {
                    await writeClawd({
                      address: CLAWD_ADDRESS, abi: CLAWD_ABI, functionName: "approve",
                      args: [VESTING_ADDRESS, clawdNeeded],
                    });
                    setTimeout(() => refetchClawdAllowance(), 2000);
                  }}
                >
                  {clawdApprovePending ? "Approving CLAWD..." : `2️⃣ Approve ${clawdAmount} CLAWD`}
                </button>
              )}

              {wethApproved && clawdApproved && (
                <button
                  className={`btn btn-accent w-full ${lockUpMining ? "loading" : ""}`}
                  disabled={lockUpMining}
                  onClick={async () => {
                    await writeLockUp({
                      functionName: "lockUp",
                      args: [wethNeeded, clawdNeeded, BigInt(Math.floor(vestDays * 86400))],
                    });
                  }}
                >
                  {lockUpMining ? "Locking..." : "3️⃣ Lock Up Liquidity"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {isLocked && isOwner && (
          <div className="bg-base-200 rounded-xl p-6 mt-6">
            <h2 className="text-xl font-bold mb-4">⚡ Actions</h2>
            <div className="space-y-3">
              <button
                className={`btn btn-primary w-full ${claimMining ? "loading" : ""}`}
                disabled={claimMining}
                onClick={() => writeClaim({ functionName: "claim" })}
              >
                {claimMining ? "Claiming..." : "💰 Claim Fees"}
              </button>
              <button
                className={`btn btn-secondary w-full ${vestMining ? "loading" : ""}`}
                disabled={vestMining}
                onClick={() => writeVest({ functionName: "vest" })}
              >
                {vestMining ? "Vesting..." : "📤 Vest"}
              </button>
              <button
                className={`btn btn-accent w-full ${claimAndVestMining ? "loading" : ""}`}
                disabled={claimAndVestMining}
                onClick={() => writeClaimAndVest({ functionName: "claimAndVest" })}
              >
                {claimAndVestMining ? "Processing..." : "🔄 Claim & Vest"}
              </button>
            </div>
          </div>
        )}

        {!connectedAddress && (
          <div className="text-center mt-8 opacity-60">
            <p>Connect your wallet to interact with the contract.</p>
          </div>
        )}
      </div>
    </div>
  );
}
