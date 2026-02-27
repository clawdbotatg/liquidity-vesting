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
        vm.createSelectFork("https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839");
        vesting = new LiquidityVesting(POSITION_MANAGER, WETH, CLAWD, POOL_FEE);
        deal(WETH, owner, WETH_AMOUNT * 100);
        deal(CLAWD, owner, CLAWD_AMOUNT * 100);
    }

    function _lockUp() internal {
        IERC20(WETH).approve(address(vesting), WETH_AMOUNT);
        IERC20(CLAWD).approve(address(vesting), CLAWD_AMOUNT);
        vesting.lockUp(WETH_AMOUNT, CLAWD_AMOUNT, VEST_DURATION);
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
        vesting.lockUp(WETH_AMOUNT, CLAWD_AMOUNT, VEST_DURATION);
    }

    function test_vest_AtHalf() public {
        _lockUp();
        uint128 initLiq = vesting.initialLiquidity();
        vm.warp(block.timestamp + VEST_DURATION / 2);
        (uint256 a0, uint256 a1) = vesting.vest();
        assertGt(a0 + a1, 0, "Should receive tokens");
        assertApproxEqRel(vesting.vestedLiquidity(), initLiq / 2, 0.02e18, "~50% vested");
    }

    function test_vest_Full_BurnsNFT() public {
        _lockUp();
        uint256 tid = vesting.tokenId();
        vm.warp(block.timestamp + VEST_DURATION + 1);
        vesting.vest();
        assertEq(vesting.vestedLiquidity(), vesting.initialLiquidity());
        vm.expectRevert();
        INonfungiblePositionManager(POSITION_MANAGER).positions(tid);
    }

    function test_vest_NothingReverts() public {
        _lockUp();
        vm.expectRevert("Nothing to vest");
        vesting.vest();
    }

    function test_vest_Sequential() public {
        _lockUp();
        uint256 start = block.timestamp;
        uint128 initLiq = vesting.initialLiquidity();
        // Vest at ~25%
        vm.warp(start + VEST_DURATION / 4);
        vesting.vest();
        uint128 v1 = vesting.vestedLiquidity();
        assertApproxEqRel(v1, uint256(initLiq) * 25 / 100, 0.02e18);
        // Vest at ~75%
        vm.warp(start + (VEST_DURATION * 3) / 4);
        vesting.vest();
        uint128 v2 = vesting.vestedLiquidity();
        assertApproxEqRel(v2, uint256(initLiq) * 75 / 100, 0.02e18);
        // Vest at 100%+
        vm.warp(start + VEST_DURATION + 1);
        vesting.vest();
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
        vesting.claimAndVest();
        assertEq(vesting.vestedLiquidity(), vesting.initialLiquidity());
    }

    function test_onlyOwner() public {
        _lockUp();
        vm.warp(block.timestamp + VEST_DURATION);
        vm.prank(address(0xBAD)); vm.expectRevert(); vesting.vest();
        vm.prank(address(0xBAD)); vm.expectRevert(); vesting.claim();
        vm.prank(address(0xBAD)); vm.expectRevert(); vesting.claimAndVest();
        vm.prank(address(0xBAD)); vm.expectRevert(); vesting.lockUp(1, 1, 300);
    }

    function test_vestedPercent() public {
        _lockUp();
        assertEq(vesting.vestedPercent(), 0);
        vm.warp(block.timestamp + VEST_DURATION / 2);
        assertApproxEqRel(vesting.vestedPercent(), 0.5e18, 0.01e18);
        vm.warp(block.timestamp + VEST_DURATION + 1);
        assertEq(vesting.vestedPercent(), 1e18);
    }
}
