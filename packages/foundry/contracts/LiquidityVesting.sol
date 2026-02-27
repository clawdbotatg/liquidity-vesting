// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface INonfungiblePositionManager {
    struct MintParams {
        address token0; address token1; uint24 fee;
        int24 tickLower; int24 tickUpper;
        uint256 amount0Desired; uint256 amount1Desired;
        uint256 amount0Min; uint256 amount1Min;
        address recipient; uint256 deadline;
    }
    struct DecreaseLiquidityParams {
        uint256 tokenId; uint128 liquidity;
        uint256 amount0Min; uint256 amount1Min; uint256 deadline;
    }
    struct CollectParams {
        uint256 tokenId; address recipient;
        uint128 amount0Max; uint128 amount1Max;
    }
    function mint(MintParams calldata) external returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    function decreaseLiquidity(DecreaseLiquidityParams calldata) external returns (uint256 amount0, uint256 amount1);
    function collect(CollectParams calldata) external returns (uint256 amount0, uint256 amount1);
    function burn(uint256 tokenId) external;
    function positions(uint256 tokenId) external view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128);
}

/// @title LiquidityVesting
/// @notice Locks WETH + CLAWD into a Uniswap V3 full-range position and vests liquidity linearly to owner
contract LiquidityVesting is Ownable {
    using SafeERC20 for IERC20;

    INonfungiblePositionManager public immutable positionManager;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    uint256 public tokenId;
    uint128 public initialLiquidity;
    uint128 public vestedLiquidity;
    uint256 public lockStart;
    uint256 public vestDuration;
    bool public isLocked;

    event LockedUp(uint256 indexed tokenId, uint128 liquidity, uint256 vestDuration);
    event Vested(uint128 liquidityReleased, uint256 amount0, uint256 amount1);
    event Claimed(uint256 amount0, uint256 amount1);

    constructor(address _positionManager, address _token0, address _token1, uint24 _fee)
        Ownable(msg.sender) {
        positionManager = INonfungiblePositionManager(_positionManager);
        token0 = _token0;
        token1 = _token1;
        fee = _fee;
    }

    function lockUp(uint256 amount0Desired, uint256 amount1Desired, uint256 _vestDuration) external onlyOwner {
        require(!isLocked, "Already locked");
        require(_vestDuration > 0, "Duration must be > 0");
        isLocked = true;
        vestDuration = _vestDuration;

        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0Desired);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1Desired);
        IERC20(token0).approve(address(positionManager), amount0Desired);
        IERC20(token1).approve(address(positionManager), amount1Desired);

        _mintPosition(amount0Desired, amount1Desired);
    }

    function _mintPosition(uint256 amount0Desired, uint256 amount1Desired) internal {
        (uint256 _tokenId, uint128 liquidity, uint256 used0, uint256 used1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: fee,
                tickLower: -887200, tickUpper: 887200,
                amount0Desired: amount0Desired, amount1Desired: amount1Desired,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );

        tokenId = _tokenId;
        initialLiquidity = liquidity;
        lockStart = block.timestamp;

        IERC20(token0).approve(address(positionManager), 0);
        IERC20(token1).approve(address(positionManager), 0);

        if (amount0Desired > used0) IERC20(token0).safeTransfer(msg.sender, amount0Desired - used0);
        if (amount1Desired > used1) IERC20(token1).safeTransfer(msg.sender, amount1Desired - used1);

        emit LockedUp(_tokenId, liquidity, vestDuration);
    }

    function claim() public onlyOwner returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = positionManager.collect(INonfungiblePositionManager.CollectParams({
            tokenId: tokenId, recipient: owner(),
            amount0Max: type(uint128).max, amount1Max: type(uint128).max
        }));
        emit Claimed(amount0, amount1);
    }

    function vest() public onlyOwner returns (uint256 amount0, uint256 amount1) {
        uint256 elapsed = block.timestamp - lockStart;
        uint256 vestedPct = elapsed >= vestDuration ? 1e18 : (elapsed * 1e18 / vestDuration);
        uint128 totalVestedLiq = uint128(vestedPct * uint256(initialLiquidity) / 1e18);
        uint128 toLiquidate = totalVestedLiq - vestedLiquidity;
        require(toLiquidate > 0, "Nothing to vest");

        vestedLiquidity += toLiquidate;
        bool isFinal = vestedLiquidity >= initialLiquidity;

        positionManager.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams({
            tokenId: tokenId, liquidity: toLiquidate,
            amount0Min: 0, amount1Min: 0, deadline: block.timestamp
        }));

        (amount0, amount1) = positionManager.collect(INonfungiblePositionManager.CollectParams({
            tokenId: tokenId, recipient: owner(),
            amount0Max: type(uint128).max, amount1Max: type(uint128).max
        }));

        if (isFinal) positionManager.burn(tokenId);
        emit Vested(toLiquidate, amount0, amount1);
    }

    function claimAndVest() external onlyOwner returns (uint256 amount0, uint256 amount1) {
        (uint256 f0, uint256 f1) = claim();
        (uint256 v0, uint256 v1) = vest();
        amount0 = f0 + v0; amount1 = f1 + v1;
    }

    function vestedPercent() external view returns (uint256) {
        if (!isLocked) return 0;
        uint256 elapsed = block.timestamp - lockStart;
        return elapsed >= vestDuration ? 1e18 : (elapsed * 1e18 / vestDuration);
    }
}
