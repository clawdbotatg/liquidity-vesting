# Security Audit Report: LiquidityVesting

**Repository:** https://github.com/clawdbotatg/liquidity-vesting  
**Auditor:** Clawd (AI Security Auditor)  
**Date:** 2026-02-27  
**Scope:** `packages/foundry/contracts/LiquidityVesting.sol`  
**Solidity Version:** ^0.8.20  
**Framework:** Scaffold-ETH 2 / Foundry  

---

## Executive Summary

LiquidityVesting is a single-contract system that locks two ERC-20 tokens (WETH + CLAWD) into a Uniswap V3 full-range position and linearly vests the liquidity to the contract owner over a configurable duration. The contract is simple, owner-gated, and non-upgradeable.

**Overall Assessment:** The contract is well-structured with a small attack surface. No critical or high-severity issues were found. Several medium and low findings relate to MEV exposure, missing input validation, and minor edge cases.

---

## Findings Summary

| ID | Severity | Title |
|----|----------|-------|
| M-1 | Medium | Zero slippage protection on mint and decreaseLiquidity |
| M-2 | Medium | `claimAndVest()` double-collects fees, inflating return values |
| L-1 | Low | No minimum `vestDuration` floor |
| L-2 | Low | Leftover token dust can be stranded in contract |
| L-3 | Low | `approve` instead of `safeApprove`/`forceApprove` for position manager |
| L-4 | Low | No way to recover accidentally sent tokens |
| I-1 | Informational | Hardcoded tick range assumes 1-bps tick spacing |
| I-2 | Informational | `vestedPercent()` returns nonzero before `lockUp` is called (edge case) |
| I-3 | Informational | Exposed Alchemy API key in test file |

---

## Detailed Findings

### M-1: Zero Slippage Protection on Mint and DecreaseLiquidity

**Severity:** Medium  
**File:** `LiquidityVesting.sol` L80-81, L108-109  
**Impact:** Sandwich attacks / MEV bots can extract value during `lockUp()` and `vest()` calls.

Both `_mintPosition` and `vest()` set `amount0Min: 0, amount1Min: 0`. This means a sandwich attacker can manipulate the pool price before the transaction, causing the user to receive significantly fewer tokens than expected.

**Remediation:** Accept `amount0Min` and `amount1Min` parameters in `lockUp()` and `vest()`, or compute reasonable minimums (e.g., 95-99% of expected amounts). At minimum, allow the owner to pass slippage parameters.

---

### M-2: `claimAndVest()` Double-Collects Fees

**Severity:** Medium  
**File:** `LiquidityVesting.sol` L116-120  
**Impact:** Misleading return values; no fund loss but confusing accounting.

`claimAndVest()` calls `claim()` (which collects all fees) then `vest()` (which also calls `collect` after decreasing liquidity). The first `claim()` already drains accrued fees, so `vest()`'s collect only picks up the tokens freed by `decreaseLiquidity`. However, the return values are summed and emitted separately, which could mislead integrators or off-chain accounting. No actual double-spend occurs since `collect` is idempotent for already-collected fees.

**Remediation:** Consider having `vest()` handle fee collection internally and removing the separate `claim()` call from `claimAndVest()`, or document clearly that calling `claim()` before `vest()` is redundant.

---

### L-1: No Minimum `vestDuration` Floor

**Severity:** Low  
**File:** `LiquidityVesting.sol` L62  
**Impact:** Owner could set `vestDuration = 1` (1 second), defeating the purpose of vesting.

The only check is `_vestDuration > 0`. A very short duration effectively means no vesting.

**Remediation:** Consider enforcing a minimum duration (e.g., 7 days) if the goal is meaningful lockup, or document that this is intentionally flexible.

---

### L-2: Leftover Token Dust Can Be Stranded

**Severity:** Low  
**File:** `LiquidityVesting.sol` L88-89  
**Impact:** If Uniswap's `mint` uses less than `amount0Desired`/`amount1Desired`, the refund logic correctly returns excess. However, tokens sent directly to the contract (not via `lockUp`) have no recovery path.

**Remediation:** Add a `sweep(address token)` function gated to `onlyOwner` that can recover arbitrary ERC-20 tokens, excluding the position NFT.

---

### L-3: `approve` Instead of `forceApprove` for Position Manager

**Severity:** Low  
**File:** `LiquidityVesting.sol` L67-68  
**Impact:** Some ERC-20 tokens (notably USDT) revert on `approve` if current allowance is nonzero. While WETH and the CLAWD token likely don't have this issue, using `forceApprove` (from SafeERC20) is defensive best practice.

**Remediation:** Replace `IERC20(token).approve(...)` with `IERC20(token).forceApprove(...)` from OpenZeppelin's SafeERC20.

---

### L-4: No Emergency Token Recovery

**Severity:** Low  
**File:** `LiquidityVesting.sol` (entire contract)  
**Impact:** If tokens are accidentally sent to the contract or if the position manager changes behavior, funds could be permanently stuck.

**Remediation:** Add an owner-gated emergency sweep function.

---

### I-1: Hardcoded Tick Range

**Severity:** Informational  
**File:** `LiquidityVesting.sol` L78-79  
**Impact:** Tick range `-887200` to `887200` is the maximum for `tickSpacing = 200` (fee tier 10000 = 1%). This is correct for this fee tier but would be wrong if the fee tier changed. Since `fee` is immutable, this is safe but fragile.

**Remediation:** Consider deriving ticks from fee tier or documenting the assumption.

---

### I-2: `vestedPercent()` Edge Case Before Lock

**Severity:** Informational  
**File:** `LiquidityVesting.sol` L123-127  
**Impact:** Before `lockUp()` is called, `lockStart = 0`, so `elapsed = block.timestamp` which could return a large (incorrect) vested percent. The `if (!isLocked) return 0` guard handles this correctly. No issue.

**Remediation:** None needed; the guard works correctly.

---

### I-3: Exposed Alchemy API Key in Test File

**Severity:** Informational  
**File:** `packages/foundry/test/LiquidityVesting.t.sol` L9  
**Impact:** The fork URL contains an Alchemy API key (`8GVG8WjDs-sGFRr6Rm839`). This is a public repo, so the key is exposed. Alchemy keys can be rate-limited or abused.

**Remediation:** Use environment variables (`vm.envString("RPC_URL")`) for fork URLs. Rotate the exposed key.

---

## Access Control Review

| Function | Access | Assessment |
|----------|--------|------------|
| `lockUp()` | `onlyOwner` | ✅ Correct |
| `claim()` | `onlyOwner` | ✅ Correct |
| `vest()` | `onlyOwner` | ✅ Correct |
| `claimAndVest()` | `onlyOwner` | ✅ Correct |
| `vestedPercent()` | Public view | ✅ Correct |

Ownership is set via OpenZeppelin `Ownable(msg.sender)` in constructor. Owner can transfer ownership via inherited `transferOwnership()`. This is intentional and appropriate.

## Reentrancy Analysis

The contract makes external calls to the Uniswap V3 NonfungiblePositionManager (a trusted protocol). State updates (`vestedLiquidity`, `isLocked`, etc.) occur before external calls in most cases. The `vest()` function updates `vestedLiquidity` before calling `decreaseLiquidity` and `collect` — this is correct. No reentrancy risk identified given the trusted external contract and owner-only access.

## Upgradeability

None. The contract is not upgradeable. All key parameters are `immutable`. This is a positive security property.

## Event Emissions

Events are emitted for all state-changing operations (`LockedUp`, `Vested`, `Claimed`). Coverage is adequate for off-chain indexing.

---

## Testing Recommendations

### Existing Test Coverage
The test suite covers: lock-up, double-lock prevention, partial vesting, full vesting with NFT burn, sequential vesting, claim, claimAndVest, access control, and vestedPercent. Coverage is good for a contract of this scope.

### Suggested Additional Tests

1. **Sandwich attack simulation:** Fork test that simulates a price manipulation before `lockUp()` to quantify slippage loss with `amount0Min = 0`.

2. **Dust/rounding test:** Test with very small liquidity amounts to verify no rounding errors cause reverts or lock funds.

3. **Fuzz test on vestDuration:** `function testFuzz_vest(uint256 elapsed)` — warp to random times and verify `vestedLiquidity` never exceeds `initialLiquidity`.

4. **Token recovery test:** After adding a sweep function, test that it can recover accidentally sent tokens.

5. **Ownership transfer test:** Verify that after `transferOwnership()`, the new owner can `vest()` and `claim()` correctly (recipient is `owner()`, which updates).

### How to Run Tests

```bash
cd packages/foundry
forge test -vvv --fork-url $BASE_RPC_URL
```

---

## Conclusion

The LiquidityVesting contract is simple, focused, and well-implemented for its purpose. The primary concern is **zero slippage protection (M-1)** which exposes lockup and vesting transactions to MEV extraction. The double-collect pattern in `claimAndVest` (M-2) is a minor accounting concern. All other findings are low or informational. The contract benefits from being non-upgradeable, single-owner, and having a minimal attack surface.

**Recommendation:** Address M-1 (slippage parameters) before deploying with significant value. Rotate the exposed Alchemy API key (I-3).
