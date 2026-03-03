"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ContractPage from "./[contractAddress]/ContractPageClient";

function AddressPageInner() {
  const searchParams = useSearchParams();
  const contractAddress = searchParams.get("contract") as `0x${string}` | null;

  if (!contractAddress) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg opacity-60">No contract address provided.</p>
      </div>
    );
  }

  return <ContractPage contractAddress={contractAddress} />;
}

export default function AddressPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <span className="loading loading-spinner loading-lg" />
        </div>
      }
    >
      <AddressPageInner />
    </Suspense>
  );
}
