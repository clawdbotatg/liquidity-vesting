"use client";

import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { useReadContract } from "wagmi";
import externalContracts from "~~/contracts/externalContracts";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const WETH_ADDRESS = externalContracts[8453].WETH.address;
const CLAWD_ADDRESS = externalContracts[8453].CLAWD.address;
const WETH_ABI = externalContracts[8453].WETH.abi;
const CLAWD_ABI = externalContracts[8453].CLAWD.abi;

export const WalletBalances = () => {
  const { address: connectedAddress } = useAccount();
  const { price: ethPrice } = useFetchNativeCurrencyPrice();

  const { data: wethBalance } = useReadContract({
    address: WETH_ADDRESS,
    abi: WETH_ABI,
    functionName: "balanceOf",
    args: [connectedAddress!],
    query: { enabled: !!connectedAddress, refetchInterval: 20_000 },
  });

  const { data: clawdBalance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: CLAWD_ABI,
    functionName: "balanceOf",
    args: [connectedAddress!],
    query: { enabled: !!connectedAddress, refetchInterval: 20_000 },
  });

  const { data: slot0 } = useScaffoldReadContract({
    contractName: "UniswapV3Pool",
    functionName: "slot0",
    watch: true,
  });

  const clawdUsdPrice = (() => {
    if (!slot0 || !ethPrice) return 0;
    const sqrtPriceX96 = slot0[0] as bigint;
    const Q96 = 2n ** 96n;
    const SCALE = 10n ** 18n;
    const ratioScaled = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / (Q96 * Q96);
    const clawdPerWeth = Number(ratioScaled) / 1e18;
    return clawdPerWeth > 0 ? ethPrice / clawdPerWeth : 0;
  })();

  if (!connectedAddress) return null;

  const wethFmt = wethBalance !== undefined ? Number(formatEther(wethBalance as bigint)).toFixed(6) : null;
  const clawdFmt = clawdBalance !== undefined ? formatEther(clawdBalance as bigint) : null;
  const wethUsd = wethFmt && ethPrice ? `($${(parseFloat(wethFmt) * ethPrice).toFixed(2)})` : "";

  return (
    <div className="fixed top-16 right-4 bg-base-200 rounded-xl p-3 text-xs z-10 shadow-md">
      <div className="opacity-50 mb-1 text-center">Your Balances</div>
      <div className="flex flex-col gap-1">
        <div>
          <span className="opacity-60">WETH </span>
          <span className="font-bold">{wethFmt ?? "—"}</span>
          {wethUsd && <span className="opacity-50 ml-1">{wethUsd}</span>}
        </div>
        <div>
          <span className="opacity-60">CLAWD </span>
          <span className="font-bold">{clawdFmt ? Number(clawdFmt).toLocaleString() : "—"}</span>
          {clawdFmt && clawdUsdPrice > 0 && (
            <span className="opacity-50 ml-1">(${(parseFloat(clawdFmt) * clawdUsdPrice).toFixed(2)})</span>
          )}
        </div>
      </div>
    </div>
  );
};
