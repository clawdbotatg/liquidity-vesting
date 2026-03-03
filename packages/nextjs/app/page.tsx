"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Address } from "@scaffold-ui/components";
import { decodeEventLog } from "viem";
import { base } from "viem/chains";
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { factoryContracts } from "~~/contracts/deployedContracts";

const FACTORY_ADDRESS = factoryContracts[8453].LiquidityVestingFactory.address;
const FACTORY_ABI = factoryContracts[8453].LiquidityVestingFactory.abi;

export default function Home() {
  const { address: connectedAddress, chain, connector } = useAccount();
  const { switchChain } = useSwitchChain();
  const router = useRouter();

  const [ownerInput, setOwnerInput] = useState("");
  const isWrongNetwork = connectedAddress && chain?.id !== 8453;

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

  // Deploy
  const { writeContract: deployWrite, data: deployHash, isPending: deployPending } = useWriteContract();
  const { data: deployReceipt, isLoading: deployWaiting } = useWaitForTransactionReceipt({ hash: deployHash });

  // Parse deployed address from receipt
  useEffect(() => {
    if (!deployReceipt) return;
    for (const log of deployReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: FACTORY_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "ContractDeployed") {
          const addr = (decoded.args as { contractAddress: string }).contractAddress;
          router.push(`/address?contract=${addr}`);
          return;
        }
      } catch {
        // not our event
      }
    }
  }, [deployReceipt, router]);

  // Your deployments
  const { data: myDeployments } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getDeploymentsByOwner",
    args: [connectedAddress!],
    query: { enabled: !!connectedAddress },
  });

  const handleDeploy = () => {
    if (!ownerInput) return;
    deployWrite({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "deploy",
      args: [ownerInput as `0x${string}`],
    });
    setTimeout(openWallet, 2000);
  };

  const isDeploying = deployPending || deployWaiting;

  return (
    <div className="flex items-center flex-col flex-grow pt-10">
      <div className="px-5 w-full max-w-2xl">
        <h1 className="text-3xl font-bold text-center mb-8">Liquidity Vesting Factory</h1>

        {!connectedAddress && (
          <div className="bg-base-200 rounded-xl p-6 text-center mb-6">
            <p className="text-sm opacity-60 mb-4">Connect your wallet to deploy and manage vesting contracts</p>
            <RainbowKitCustomConnectButton />
          </div>
        )}

        {isWrongNetwork && (
          <div className="bg-warning/20 border border-warning rounded-xl p-6 mb-6 text-center">
            <p className="font-bold text-lg mb-3">⚠️ Wrong Network</p>
            <button className="btn btn-warning btn-sm" onClick={() => switchChain({ chainId: base.id })}>
              Switch to Base
            </button>
          </div>
        )}

        {/* Deploy Form */}
        <div className="bg-base-200 rounded-xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">🚀 Deploy New Contract</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-semibold">Owner Address</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input input-bordered w-full font-mono text-sm"
                  placeholder="0x..."
                  value={ownerInput}
                  onChange={e => setOwnerInput(e.target.value)}
                />
                {connectedAddress && (
                  <button
                    className="btn btn-ghost btn-sm whitespace-nowrap"
                    onClick={() => setOwnerInput(connectedAddress)}
                  >
                    Use my wallet
                  </button>
                )}
              </div>
            </div>
            <button
              className="btn btn-primary w-full"
              disabled={!ownerInput || isDeploying || !connectedAddress || !!isWrongNetwork}
              onClick={handleDeploy}
            >
              {isDeploying && <span className="loading loading-spinner loading-sm mr-2" />}
              {isDeploying ? "Deploying..." : "Deploy"}
            </button>
          </div>
        </div>

        {/* Your Deployments */}
        {connectedAddress && !isWrongNetwork && (
          <div className="bg-base-200 rounded-xl p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">📋 Your Deployments</h2>
            {!myDeployments || myDeployments.length === 0 ? (
              <p className="text-sm opacity-60">No deployments yet</p>
            ) : (
              <div className="space-y-2">
                {(myDeployments as string[]).map((addr: string) => (
                  <Link
                    key={addr}
                    href={`/address?contract=${addr}`}
                    className="flex items-center gap-2 p-3 bg-base-300 rounded-lg hover:bg-base-100 transition-colors"
                  >
                    <Address address={addr as `0x${string}`} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col items-center mt-4 mb-4 text-sm opacity-60">
          <p className="mb-1">Factory Contract</p>
          <Address address={FACTORY_ADDRESS} />
        </div>
      </div>
    </div>
  );
}
