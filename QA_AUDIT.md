# QA Audit Report — Liquidity Vesting

**Date:** 2026-02-27
**Auditor:** ClawdHeart (Opus 4.6)
**Skills Applied:** ethskills.com/qa, ethskills.com/frontend-ux, ethskills.com/frontend-playbook

## Summary

Liquidity Vesting is a single-page dApp on Base that lets an owner lock WETH + CLAWD into a Uniswap V3 full-range position, then linearly vest (withdraw) that liquidity over a configurable duration. Fees can be claimed independently. The smart contract is clean and well-tested. The frontend has several ship-blocking issues — mostly SE2 branding remnants, missing wallet UX patterns, and raw `useWriteContract` usage.

## Ship-Blocking Issues

### 🚨 1. Wallet Flow — Text Instead of Button
- **FAIL** — `packages/nextjs/app/page.tsx:297` displays `<p>Connect your wallet to interact with the contract.</p>` — a passive text paragraph instead of a prominent Connect Wallet button.
- **Fix:** Replace with `<RainbowKitCustomConnectButton />` or a styled button that triggers the RainbowKit modal.

### 🚨 2. Four-State Button Flow — No Network Check
- **FAIL** — There is no "Switch to Base" button when the user is on the wrong network. The page only checks `connectedAddress` and `isOwner` but never validates `chainId`.
- **FAIL** — No connect wallet button in the action area (only text, see #1).
- **Fix:** Wrap action sections in a four-state component: Connect → Switch Network → Approve → Action.

### 🚨 3. Raw `useWriteContract` Used for Approvals
- **FAIL** — `packages/nextjs/app/page.tsx:71-72` uses raw wagmi `useWriteContract()` for WETH and CLAWD approvals instead of `useScaffoldWriteContract`. This bypasses scaffold's error handling, toast notifications, and transaction tracking.
- **Fix:** Use `useScaffoldWriteContract` with externalContracts or wrap with `useTransactor`.

### 🚨 4. SE2 Branding Not Removed
- **FAIL** — `packages/nextjs/app/layout.tsx:11`: Tab title is `'Scaffold-ETH 2 App'`, description is `'Built with 🏗 Scaffold-ETH 2'`.
- **FAIL** — `packages/nextjs/utils/scaffold-eth/getMetadata.ts:5`: `titleTemplate` is `"%s | Scaffold-ETH 2"`.
- **FAIL** — `packages/nextjs/components/Footer.tsx:42-60`: Full SE2 footer with "Fork me" link to se-2 repo, BuidlGuidl branding, and Telegram support link.
- **FAIL** — `packages/nextjs/services/web3/wagmiConnectors.tsx:36`: `appName: "scaffold-eth-2"`.
- **FAIL** — `README.md`: Entirely SE2 template README, not project-specific.
- **FAIL** — `packages/nextjs/public/favicon.png`: Default SE2 favicon (not verified changed).
- **Fix:** Update all of the above to reflect "Liquidity Vesting" branding.

## Should Fix Issues

### ⚠️ 5. No USD Values Displayed
- **FAIL** — Token balances (WETH, CLAWD) shown as raw numbers with no USD equivalent anywhere on the page.
- **Fix:** Use `useNativeCurrencyPrice()` for WETH→USD. For CLAWD, use DexScreener API or onchain quoter.

### ⚠️ 6. Contract Address Not Displayed
- **FAIL** — The deployed LiquidityVesting contract address is never shown to the user. No `<Address/>` component usage on the main page.
- **Fix:** Display `vestingAddress` using `<Address address={vestingAddress} />` in the status panel.

### ⚠️ 7. Connected Address Shown as Raw Hex
- **FAIL** — `packages/nextjs/app/page.tsx:114-116` displays connected address as `{connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}` — raw hex truncation instead of using `<Address/>` component.
- **Fix:** Replace with `<Address address={connectedAddress} />`.

### ⚠️ 8. OG Image Uses Relative Path
- **FAIL** — `packages/nextjs/utils/scaffold-eth/getMetadata.ts:14` uses `imageRelativePath = "/thumbnail.jpg"`. While it constructs an absolute URL via `baseUrl`, if `VERCEL_PROJECT_PRODUCTION_URL` is not set, it falls back to `localhost`. The OG image URL should be hardcoded to the production absolute URL.
- **Fix:** Set an explicit absolute URL like `https://liquidity-vesting.vercel.app/thumbnail.jpg`.

### ⚠️ 9. Polling Interval Too Slow
- **FAIL** — `packages/nextjs/scaffold.config.ts:20`: `pollingInterval: 30000` (30s default). Should be 3000ms for responsive UX.
- **Fix:** Change to `pollingInterval: 3000`.

### ⚠️ 10. Default Alchemy API Key
- **FAIL** — `packages/nextjs/scaffold.config.ts:7,21`: Uses `DEFAULT_ALCHEMY_API_KEY = "cR4WnXePioePZ5fFrnSiR"` — the SE2 shared key.
- **Fix:** Use project-specific key via env var only, remove hardcoded default.

### ⚠️ 11. Bare `http()` in wagmiConfig Fallback
- **FAIL** — `packages/nextjs/services/web3/wagmiConfig.tsx` includes bare `http()` in rpcFallbacks, which uses the chain's default public RPC — unreliable for production.
- **Fix:** Remove bare `http()` fallback or replace with a project-controlled RPC.

### ⚠️ 12. No Phantom Wallet in RainbowKit
- **FAIL** — `packages/nextjs/services/web3/wagmiConnectors.tsx`: No `phantomWallet` in the wallets array. Phantom is a popular wallet on Base.
- **Fix:** Add `phantomWallet` to the wallets array.

### ⚠️ 13. No Mobile Deep Linking
- **FAIL** — No `setTimeout(openWallet, 2000)` pattern after transaction calls. Mobile users on WalletConnect won't be redirected to their wallet app.
- **Fix:** Add deep link logic after each `writeContractAsync` call.

### ⚠️ 14. Hardcoded Alchemy Key in Test File
- **FAIL** — `packages/foundry/test/LiquidityVesting.t.sol:12`: Hardcoded Alchemy API key in fork URL (`8GVG8WjDs-sGFRr6Rm839`). This should use an env var.
- **Fix:** Use `vm.envString("BASE_RPC_URL")` or `.env`.

## Passed Checks

- ✅ **DaisyUI Semantic Colors** — Page uses `bg-base-200`, `bg-base-300`, `bg-primary`, `text-base-content` etc. No hardcoded dark backgrounds in app/.
- ✅ **Four-State Approval Flow (Partial)** — Lock-up section correctly shows one button at a time: Approve WETH → Approve CLAWD → Lock Up. Buttons are disabled while pending.
- ✅ **Individual Loading States** — Each button has its own `isPending`/`isMining` state and spinner text ("Approving WETH...", "Locking...", "Claiming...", etc.).
- ✅ **Button Disabled While Pending** — All buttons use `disabled={...Pending}` or `disabled={...Mining}`.
- ✅ **No Duplicate H1 Title** — Only one `<h1>` on the page (the app title), not duplicated from header.
- ✅ **Owner-Only UI Gating** — Lock-up and action sections only render for `isOwner`, good UX.
- ✅ **Solidity 0.8.20** — Built-in overflow protection, no SafeMath needed (SafeERC20 correctly used for transfers).

## Smart Contract Notes

- ✅ **Access Control** — All mutating functions are `onlyOwner`. Good.
- ✅ **Reentrancy** — No reentrancy risk: state updated before external calls in `vest()` (`vestedLiquidity += toLiquidate` before `decreaseLiquidity`/`collect`). `lockUp` sets `isLocked = true` before external calls.
- ✅ **Events** — Proper events emitted for all state changes.
- ✅ **No Hardcoded Addresses** — Constructor takes all addresses as parameters.
- ✅ **Solidity 0.8.20** — Overflow/underflow protection built in.
- ✅ **Tests** — Comprehensive test suite covering lockup, sequential vesting, full vesting with NFT burn, onlyOwner, and edge cases.
- ⚠️ **Slippage** — `amount0Min: 0, amount1Min: 0` in both `mint` and `decreaseLiquidity`. Acceptable for owner-only operations but worth noting.
- ⚠️ **Single-Use** — Contract can only lock once (`require(!isLocked)`). No way to reset after full vest. By design, but worth documenting.
- ⚠️ **`claim()` then `vest()` in `claimAndVest()`** — `claim()` collects all fees first, then `vest()` calls `collect()` again after `decreaseLiquidity`. The second collect gets the removed liquidity tokens. This works correctly but the return values of `claimAndVest` sum both, which could double-count if fees accrue between the two calls (negligible in same tx).

## Recommended Fixes (Priority Order)

1. **Replace "Connect your wallet" text with a Connect Wallet button** — `page.tsx:297`
2. **Add network check / "Switch to Base" button** — wrap all actions in four-state flow
3. **Replace raw `useWriteContract` with `useScaffoldWriteContract`** for approvals — `page.tsx:71-72`
4. **Remove all SE2 branding** — layout.tsx title, Footer.tsx, wagmiConnectors appName, README, favicon, getMetadata titleTemplate
5. **Display contract address with `<Address/>`** component
6. **Replace raw hex address display with `<Address/>`** — `page.tsx:114-116`
7. **Add USD values** next to WETH and CLAWD balances
8. **Set `pollingInterval: 3000`** — scaffold.config.ts
9. **Add `phantomWallet`** to wagmiConnectors.tsx
10. **Add mobile deep linking** after transaction calls
11. **Hardcode absolute OG image URL** for production
12. **Remove default Alchemy key** and bare `http()` fallback
13. **Move Alchemy key in test to env var** — LiquidityVesting.t.sol:12
