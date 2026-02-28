// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityVesting.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityVestingTest is Test {
    address constant POSITION_MANAGER = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    uint24 constant POOL_FEE = 10000;
    uint256 constant VEST_DURATION = 300;

    LiquidityVesting public vesting;
    address public owner = address(this);
    uint256 constant WETH_AMOUNT = 0.001 ether;
    uint256 constant CLAWD_AMOUNT = 500_000 * 1e18;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));
        vesting = new LiquidityVesting(POSITION_MANAGER, WETH, CLAWD, POOL_FEE);
        deal(WETH, owner, WETH_AMOUNT * 100);
        deal(CLAWD, owner, CLAWD_AMOUNT * 100);
    }

    function _lockUp() internal {
        IERC20(WETH).approve(address(vesting), WETH_AMOUNT);
        IERC20(CLAWD).approve(address(vesting), CLAWD_AMOUNT);
        vesting.lockUp(WETH_AMOUNT, CLAWD_AMOUNT, VEST_DURATION, int24(-887200), int24(887200), 0, 0);
    }

    function test_lockUp_MintsPosition() public {
        uint256 wethBefore = IERC20(WETH).balanceOf(owner);
        _lockUp();
        assertTrue(vesting.isLocked());
        assertGt(vesting.tokenId(), 0);
        assertGt(vesting.initialLiquidity(), 0);
        assertEq(vesting.lockStart(), block.timestamp);
        assertEq(vesting.vestDuration(), VEST_DURATION);
        assertLt(IERC20(WETH).balanceOf(owner), wethBefore);
    }

    function test_lockUp_CannotCallTwice() public {
        _lockUp();
        IERC20(WETH).approve(address(vesting), WETH_AMOUNT);
        IERC20(CLAWD).approve(address(vesting), CLAWD_AMOUNT);
        vm.expectRevert("Already locked");
        vesting.lockUp(WETH_AMOUNT, CLAWD_AMOUNT, VEST_DURATION, int24(-887200), int24(887200), 0, 0);
    }

    function test_vest_AtHalf() public {
        _lockUp();
        uint128 initLiq = vesting.initialLiquidity();
        vm.warp(block.timestamp + VEST_DURATION / 2);
        (uint256 a0, uint256 a1) = vesting.vest(0, 0);
        assertGt(a0 + a1, 0, "Should receive tokens");
        assertApproxEqRel(vesting.vestedLiquidity(), initLiq / 2, 0.02e18, "~50% vested");
    }

    function test_vest_Full_BurnsNFT() public {
        _lockUp();
        uint256 tid = vesting.tokenId();
        vm.warp(block.timestamp + VEST_DURATION + 1);
        vesting.vest(0, 0);
        assertEq(vesting.vestedLiquidity(), vesting.initialLiquidity());
        vm.expectRevert();
        INonfungiblePositionManager(POSITION_MANAGER).positions(tid);
    }

    function test_vest_NothingReverts() public {
        _lockUp();
        vm.expectRevert("Nothing to vest");
        vesting.vest(0, 0);
    }

    function test_vest_Sequential() public {
        _lockUp();
        uint256 start = block.timestamp;
        uint128 initLiq = vesting.initialLiquidity();
        vm.warp(start + VEST_DURATION / 4);
        vesting.vest(0, 0);
        uint128 v1 = vesting.vestedLiquidity();
        assertApproxEqRel(v1, uint256(initLiq) * 25 / 100, 0.02e18);
        vm.warp(start + (VEST_DURATION * 3) / 4);
        vesting.vest(0, 0);
        uint128 v2 = vesting.vestedLiquidity();
        assertApproxEqRel(v2, uint256(initLiq) * 75 / 100, 0.02e18);
        vm.warp(start + VEST_DURATION + 1);
        vesting.vest(0, 0);
        assertEq(vesting.vestedLiquidity(), initLiq);
    }

    function test_claim() public {
        _lockUp();
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);
        vesting.claim();
    }

    function test_claimAndVest() public {
        _lockUp();
        vm.warp(block.timestamp + VEST_DURATION);
        vesting.claimAndVest(0, 0);
        assertEq(vesting.vestedLiquidity(), vesting.initialLiquidity());
    }

    function test_onlyOwner() public {
        _lockUp();
        vm.warp(block.timestamp + VEST_DURATION);
        vm.prank(address(0xBAD)); vm.expectRevert(); vesting.vest(0, 0);
        vm.prank(address(0xBAD)); vm.expectRevert(); vesting.claim();
        vm.prank(address(0xBAD)); vm.expectRevert(); vesting.claimAndVest(0, 0);
        vm.prank(address(0xBAD)); vm.expectRevert(); vesting.lockUp(1, 1, 300, int24(-887200), int24(887200), 0, 0);
    }

    function test_vestedPercent() public {
        _lockUp();
        assertEq(vesting.vestedPercent(), 0);
        vm.warp(block.timestamp + VEST_DURATION / 2);
        assertApproxEqRel(vesting.vestedPercent(), 0.5e18, 0.01e18);
        vm.warp(block.timestamp + VEST_DURATION + 1);
        assertEq(vesting.vestedPercent(), 1e18);
    }

    function test_sweep() public {
        // Sweep after unlock (final vest)
        _lockUp();
        vm.warp(block.timestamp + VEST_DURATION + 1);
        vesting.vest(0, 0);
        // Now unlocked, deal and sweep WETH
        deal(WETH, address(vesting), 1 ether);
        uint256 before = IERC20(WETH).balanceOf(owner);
        vesting.sweep(WETH);
        assertEq(IERC20(WETH).balanceOf(address(vesting)), 0);
        assertEq(IERC20(WETH).balanceOf(owner), before + 1 ether);
    }

    function test_sweep_RevertOnNFT() public {
        _lockUp();
        vm.expectRevert("cannot sweep position manager");
        vesting.sweep(POSITION_MANAGER);
    }

    function test_sweep_locked_tokens_reverts() public {
        _lockUp();
        deal(WETH, address(vesting), 1 ether);
        vm.expectRevert("cannot sweep locked tokens");
        vesting.sweep(WETH);
    }

    function test_renounceOwnership_disabled() public {
        vm.expectRevert("renounce disabled");
        vesting.renounceOwnership();
    }

    function test_claim_beforeLockup_reverts() public {
        vm.expectRevert("Not locked");
        vesting.claim();
    }

    function test_vest_beforeLockup_reverts() public {
        vm.expectRevert("Not locked");
        vesting.vest(0, 0);
    }

    function test_isLocked_cleared_after_final_vest() public {
        _lockUp();
        vm.warp(block.timestamp + VEST_DURATION + 1);
        vesting.vest(0, 0);
        assertEq(vesting.isLocked(), false);
        assertEq(vesting.tokenId(), 0);
    }
}
