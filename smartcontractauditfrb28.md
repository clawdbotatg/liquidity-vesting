# Smart Contract Audit Report — LiquidityVesting

**Auditor**: clawd (clawdhead.eth) — AI security auditor powered by ethskills.com  
**Date**: 2025-02-28  
**Contract**: `LiquidityVesting.sol`  
**Repo**: https://github.com/clawdbotatg/liquidity-vesting  
**Solidity**: ^0.8.20  
**Chain**: Base (hardcoded Uniswap V3 factory: `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`)  
**Skills Applied**: evm-audit-general, evm-audit-precision-math, evm-audit-erc20, evm-audit-defi-amm, evm-audit-access-control, evm-audit-dos

---

## Executive Summary

The `LiquidityVesting` contract locks WETH + CLAWD into a Uniswap V3 position and linearly vests liquidity to the owner over a configurable duration. The contract is well-structured for its purpose: single-owner, non-upgradeable, focused scope. The owner is transferred to a Safe multisig (`safe.clawd.atg.eth`) at deployment.

**Overall Risk**: Low-Medium. No critical or high-severity issues found. Several medium and low findings related to precision edge cases, missing deadline protection, and hardcoded factory address.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 4 |
| Info | 5 |

---

## Findings

### [M-1] `block.timestamp` as deadline offers zero MEV protection

**Severity**: Medium  
**Category**: evm-audit-defi-amm (slippage/deadline)  
**Location**: `_mintPosition()` line: `deadline: block.timestamp`, `_vest()` line: `deadline: block.timestamp`  

**Description**: Both `mint()` and `decreaseLiquidity()` pass `deadline: block.timestamp`. This is a no-op — `block.timestamp` always equals the current block's timestamp, so the deadline check always passes regardless of when the transaction is included. A validator or MEV bot can hold the transaction in the mempool and execute it at an unfavorable time (e.g., after a large price move), and the deadline will still pass.

**Proof of Concept**: 
1. Owner submits `lockUp()` or `vest()` transaction
2. MEV bot/validator holds the tx for N blocks
3. Price moves significantly
4. Tx is included — `block.timestamp` check always passes
5. Liquidity is minted/removed at a worse price than intended

**Recommendation**: Accept a `deadline` parameter from the caller:
```solidity
function lockUp(
    uint256 amount0Desired, uint256 amount1Desired, 
    uint256 _vestDuration, int24 _tickLower, int24 _tickUpper, 
    uint256 amount0Min, uint256 amount1Min,
    uint256 deadline // ADD THIS
) external onlyOwner {
    // ...
    _mintPosition(amount0Desired, amount1Desired, _tickLower, _tickUpper, amount0Min, amount1Min, deadline);
}
```

---

### [M-2] Precision loss in vesting calculation can leave dust liquidity permanently locked

**Severity**: Medium  
**Category**: evm-audit-precision-math  
**Location**: `_vest()` — `uint128 totalVestedLiq = uint128(vestedPct * uint256(initialLiquidity) / 1e18);`  

**Description**: The vesting math uses fixed-point arithmetic with 1e18 scaling. Due to integer division truncation, the calculated `totalVestedLiq` at 100% elapsed may be slightly less than `initialLiquidity` if `initialLiquidity` is not a clean multiple of the precision scaling. Specifically:

When `elapsed >= vestDuration`, `vestedPct = 1e18`, so `totalVestedLiq = uint128(1e18 * uint256(initialLiquidity) / 1e18) = initialLiquidity`. This case is fine.

However, for intermediate vest calls, rounding truncation means the sum of multiple partial vests may not perfectly equal `initialLiquidity`. The contract handles this via the `elapsed >= vestDuration` → `vestedPct = 1e18` path, which correctly caps at full liquidity. But there's a subtle edge: if the **final** vest call happens at exactly `vestDuration` (not `vestDuration + 1`), it works. The issue is that `vestedPct` caps correctly.

After deeper analysis: the math is correct when `elapsed >= vestDuration` because `vestedPct` hard-caps to `1e18`, and `1e18 * initialLiquidity / 1e18 == initialLiquidity` exactly. **Downgrading concern**: the dust issue doesn't materialize at full vest. However, individual partial vest calls will lose up to 1 wei of liquidity per call due to truncation — this liquidity is effectively locked until the final vest.

**Recommendation**: This is acceptable for the current design (final vest recovers everything), but document the truncation behavior. Consider using `mulDiv` with rounding up for the partial calculations if you want intermediate vest amounts to be maximally generous:
```solidity
uint128 totalVestedLiq = elapsed >= vestDuration 
    ? initialLiquidity 
    : uint128(FullMath.mulDiv(elapsed, uint256(initialLiquidity), vestDuration));
```
This avoids the double-division through 1e18 and gives better precision.

---

### [M-3] `previewVest()` hardcodes Uniswap V3 factory address for Base only

**Severity**: Medium  
**Category**: evm-audit-general (deployment)  
**Location**: `previewVest()` — `IUniswapV3Factory(0x33128a8fC17869897dcE68Ed026d694621f6FDfD)`  

**Description**: The `previewVest()` view function hardcodes the Base Uniswap V3 factory address. While the constructor accepts an arbitrary `positionManager` address (making the core contract chain-agnostic), the preview function is permanently Base-only. If this contract were deployed on mainnet, Arbitrum, or any other chain, `previewVest()` would return incorrect results or revert.

**Proof of Concept**: Deploy to Ethereum mainnet → `previewVest()` calls `getPool()` on a random Base address on mainnet → reverts or returns wrong pool.

**Recommendation**: Accept the factory address as a constructor parameter or derive it from the position manager:
```solidity
IUniswapV3Factory public immutable factory;

constructor(..., address _factory) {
    factory = IUniswapV3Factory(_factory);
}
```

---

### [L-1] No slippage protection by default — callers must remember to set non-zero mins

**Severity**: Low  
**Category**: evm-audit-defi-amm  
**Location**: `lockUp()`, `vest()`, `claimAndVest()`  

**Description**: While the contract correctly exposes `amount0Min` and `amount1Min` parameters, the test suite always passes `0, 0` for both. This sets a precedent for callers. The Safe multisig operators may follow the test pattern and execute with zero slippage protection, enabling sandwich attacks.

**Recommendation**: Add comments/NatSpec strongly warning against zero slippage. Consider adding a configurable minimum slippage floor that the owner can set.

---

### [L-2] `sweep()` allows sweeping `token0`/`token1` after unlock — no timelock

**Severity**: Low  
**Category**: evm-audit-access-control  
**Location**: `sweep()`  

**Description**: After the position is fully vested (`isLocked == false`), the owner can sweep `token0` and `token1`. This is intentional for recovering dust. However, if tokens are accidentally sent to the contract between vesting cycles (if the contract were reused), they could be swept immediately with no delay.

The current design is single-use (no re-lock after unlock), so the impact is minimal. But `sweep()` has no timelock or event for transparency.

**Recommendation**: Emit an event for `sweep()` for transparency:
```solidity
event Swept(address indexed token, uint256 amount);
```

---

### [L-3] `claim()` can be called repeatedly with no tokens to collect

**Severity**: Low  
**Category**: evm-audit-dos  
**Location**: `claim()`  

**Description**: `claim()` doesn't check if there are actually fees to collect. It will call `positionManager.collect()` and emit `Claimed(0, 0)`. This wastes gas and emits misleading events.

**Recommendation**: Add a check:
```solidity
require(amount0 > 0 || amount1 > 0, "Nothing to claim");
```

---

### [L-4] No re-lock capability — contract is single-use

**Severity**: Low  
**Category**: evm-audit-general  
**Location**: Contract architecture  

**Description**: After the position is fully vested and burned, `isLocked` is set to `false` and `tokenId` to `0`, but there's no way to create a new lock. The contract becomes a dead shell. This is a design choice, not a bug, but it means a new contract must be deployed for each vesting period.

**Recommendation**: If reuse is desired, allow `lockUp()` to be called again after `isLocked == false`. The current `require(!isLocked)` check already permits this, but `vestedLiquidity` is not reset:
```solidity
function lockUp(...) external onlyOwner {
    require(!isLocked, "Already locked");
    // ADD: reset vesting state for reuse
    vestedLiquidity = 0;
    // ...
}
```

---

### [I-1] `renounceOwnership()` is disabled — good practice

**Severity**: Info  
**Category**: evm-audit-access-control  

**Description**: `renounceOwnership()` reverts with "renounce disabled". This is correct — renouncing ownership would permanently lock any remaining vested liquidity. Well done.

---

### [I-2] `SafeERC20.forceApprove` used correctly for approval management

**Severity**: Info  
**Category**: evm-audit-erc20  

**Description**: The contract uses `forceApprove()` for setting approvals and resets to 0 after minting. This handles USDT-style approval quirks correctly and minimizes approval exposure. The pattern is:
1. `forceApprove(positionManager, amount)` before mint
2. `forceApprove(positionManager, 0)` after mint

This is best practice.

---

### [I-3] `previewClaim()` only shows `tokensOwed`, not real-time accrued fees

**Severity**: Info  
**Category**: evm-audit-general  

**Description**: `previewClaim()` reads `tokensOwed0`/`tokensOwed1` from the position manager. These values are only updated when liquidity is modified or `collect()` is called — they don't reflect real-time accrued fees from swaps. The actual collectable amount may be higher than what `previewClaim()` reports.

**Recommendation**: Document this limitation in NatSpec. A more accurate preview would require simulating a `collect()` call, which isn't possible in a view function.

---

### [I-4] Deployment script correctly transfers ownership to Safe multisig

**Severity**: Info  
**Category**: evm-audit-access-control  

**Description**: `DeployLiquidityVesting.s.sol` transfers ownership to `0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0` (safe.clawd.atg.eth). This is good — the vesting contract is controlled by a multisig, not an EOA. Note: this is a single-step `transferOwnership`, not two-step. Since the Safe address is hardcoded and known to be correct, this is acceptable.

---

### [I-5] TickMath, FullMath, and LiquidityAmounts are battle-tested Uniswap libraries

**Severity**: Info  
**Category**: evm-audit-precision-math  

**Description**: The inlined math libraries are direct ports from Uniswap V3's `TickMath.sol`, `FullMath.sol`, and `LiquidityAmounts.sol`, adapted for Solidity 0.8's checked arithmetic. These are extremely well-audited and battle-tested. The `unchecked` blocks in `TickMath.getSqrtRatioAtTick()` and `FullMath.mulDiv()` are correct — they replicate the original Uniswap V3 behavior which intentionally uses wrapping arithmetic.

---

## Checklist Items Reviewed (No Finding)

The following checklist categories were reviewed and found **not applicable or correctly handled**:

| Check | Result |
|-------|--------|
| Reentrancy (standard, cross-contract, read-only) | ✅ No callbacks from positionManager that could re-enter. CEI pattern followed. |
| Fee-on-transfer token handling | ✅ WETH and CLAWD are known tokens — neither has fees. Unused amounts refunded via balance diff. |
| Force-feeding ETH | ✅ Contract doesn't use `address(this).balance` for logic. |
| Unbounded loops | ✅ No loops in the contract. |
| `msg.value` in loops/multicall | ✅ No payable functions, no multicall. |
| Flash loan attacks | ✅ No price oracle dependency in state-changing functions. `previewVest()` uses spot price but is view-only. |
| Delegatecall | ✅ Not used. |
| Upgradeable proxy | ✅ Not upgradeable. |
| Signature replay | ✅ No signatures used. |
| Integer overflow in unchecked blocks | ✅ Unchecked blocks are in Uniswap math libraries — correct by construction. |
| Downcast overflow | ✅ `uint128()` cast of `vestedPct * initialLiquidity / 1e18` — max value is `initialLiquidity` which is already `uint128`. Safe. |
| Access control on all state-changing functions | ✅ All guarded by `onlyOwner`. |
| Pause mechanism | ✅ No pause — acceptable for single-owner vesting contract. |
| ERC777 hook reentrancy | ✅ WETH and CLAWD are known non-ERC777 tokens. |
| `abi.encodePacked` collision | ✅ Not used. |
| Storage pointer issues | ✅ No complex storage patterns. |

---

## Gas Optimizations (Out of Scope, Noted)

1. `previewVest()` calls `positionManager.positions()` which returns 12 values — only 4 are used. This is inherent to the interface.
2. `_vest()` always calls `collect()` with `type(uint128).max` — correct and gas-efficient approach.

---

## Conclusion

The `LiquidityVesting` contract is well-designed for its purpose. The main actionable items are:

1. **[M-1]** Replace `block.timestamp` deadline with a caller-specified parameter
2. **[M-3]** Make the factory address configurable instead of hardcoded
3. **[L-4]** Reset `vestedLiquidity` in `lockUp()` if contract reuse is intended

The contract demonstrates good security practices: `SafeERC20`, approval hygiene, disabled `renounceOwnership`, and ownership transfer to a Safe multisig.

---

*Audit performed using [ethskills.com](https://ethskills.com) audit methodology with 500+ checklist items across 6 specialized skill modules.*
