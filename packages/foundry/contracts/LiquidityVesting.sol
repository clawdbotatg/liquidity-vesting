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

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IUniswapV3Pool {
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
    function liquidity() external view returns (uint128);
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

    /// @notice Lock tokens into a Uniswap V3 position with slippage protection
    /// @param amount0Desired Desired amount of token0
    /// @param amount1Desired Desired amount of token1
    /// @param _vestDuration Vesting duration in seconds
    /// @param amount0Min Minimum token0 accepted (0 to skip)
    /// @param amount1Min Minimum token1 accepted (0 to skip)
    function lockUp(uint256 amount0Desired, uint256 amount1Desired, uint256 _vestDuration, int24 _tickLower, int24 _tickUpper, uint256 amount0Min, uint256 amount1Min) external onlyOwner {
        require(!isLocked, "Already locked");
        require(_vestDuration > 0, "Duration must be > 0");
        isLocked = true;
        vestDuration = _vestDuration;

        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0Desired);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1Desired);
        IERC20(token0).forceApprove(address(positionManager), amount0Desired);
        IERC20(token1).forceApprove(address(positionManager), amount1Desired);

        _mintPosition(amount0Desired, amount1Desired, _tickLower, _tickUpper, amount0Min, amount1Min);
    }

    function _mintPosition(uint256 amount0Desired, uint256 amount1Desired, int24 _tickLower, int24 _tickUpper, uint256 amount0Min, uint256 amount1Min) internal {
        (uint256 _tokenId, uint128 liquidity, uint256 used0, uint256 used1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: fee,
                tickLower: _tickLower, tickUpper: _tickUpper,
                amount0Desired: amount0Desired, amount1Desired: amount1Desired,
                amount0Min: amount0Min, amount1Min: amount1Min,
                recipient: address(this), deadline: block.timestamp
            })
        );

        tokenId = _tokenId;
        initialLiquidity = liquidity;
        lockStart = block.timestamp;

        IERC20(token0).forceApprove(address(positionManager), 0);
        IERC20(token1).forceApprove(address(positionManager), 0);

        if (amount0Desired > used0) IERC20(token0).safeTransfer(msg.sender, amount0Desired - used0);
        if (amount1Desired > used1) IERC20(token1).safeTransfer(msg.sender, amount1Desired - used1);

        emit LockedUp(_tokenId, liquidity, vestDuration);
    }

    function renounceOwnership() public pure override {
        revert("renounce disabled");
    }

    function claim() public onlyOwner returns (uint256 amount0, uint256 amount1) {
        require(isLocked, "Not locked");
        (amount0, amount1) = positionManager.collect(INonfungiblePositionManager.CollectParams({
            tokenId: tokenId, recipient: owner(),
            amount0Max: type(uint128).max, amount1Max: type(uint128).max
        }));
        emit Claimed(amount0, amount1);
    }

    /// @notice Vest available liquidity with slippage protection
    /// @param amount0Min Minimum token0 from decreaseLiquidity (0 to skip)
    /// @param amount1Min Minimum token1 from decreaseLiquidity (0 to skip)
    function vest(uint256 amount0Min, uint256 amount1Min) public onlyOwner returns (uint256 amount0, uint256 amount1) {
        require(isLocked, "Not locked");
        return _vest(amount0Min, amount1Min, false);
    }

    /// @notice Claim fees and vest in one call, collecting only once
    function claimAndVest(uint256 amount0Min, uint256 amount1Min) external onlyOwner returns (uint256 amount0, uint256 amount1) {
        require(isLocked, "Not locked");
        return _vest(amount0Min, amount1Min, true);
    }

    /// @dev Internal vest that optionally includes fee collection
    function _vest(uint256 amount0Min, uint256 amount1Min, bool includeFees) internal returns (uint256 amount0, uint256 amount1) {
        uint256 elapsed = block.timestamp - lockStart;
        uint256 vestedPct = elapsed >= vestDuration ? 1e18 : (elapsed * 1e18 / vestDuration);
        uint128 totalVestedLiq = uint128(vestedPct * uint256(initialLiquidity) / 1e18);
        uint128 toLiquidate = totalVestedLiq - vestedLiquidity;
        require(toLiquidate > 0, "Nothing to vest");

        vestedLiquidity += toLiquidate;
        bool isFinal = vestedLiquidity >= initialLiquidity;

        positionManager.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams({
            tokenId: tokenId, liquidity: toLiquidate,
            amount0Min: amount0Min, amount1Min: amount1Min, deadline: block.timestamp
        }));

        // Single collect picks up both decreased liquidity tokens AND accrued fees
        (amount0, amount1) = positionManager.collect(INonfungiblePositionManager.CollectParams({
            tokenId: tokenId, recipient: owner(),
            amount0Max: type(uint128).max, amount1Max: type(uint128).max
        }));

        if (isFinal) {
            positionManager.burn(tokenId);
            isLocked = false;
            tokenId = 0;
        }

        if (includeFees) {
            emit Claimed(amount0, amount1);
        }
        emit Vested(toLiquidate, amount0, amount1);
    }

    /// @notice Sweep stranded ERC-20 tokens (not the position NFT)
    function sweep(address token) external onlyOwner {
        require(token != address(positionManager), "cannot sweep position manager");
        require(
            !isLocked || (token != token0 && token != token1),
            "cannot sweep locked tokens"
        );
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "nothing to sweep");
        IERC20(token).safeTransfer(owner(), balance);
    }

    function vestedPercent() public view returns (uint256) {
        if (!isLocked) return 0;
        uint256 elapsed = block.timestamp - lockStart;
        return elapsed >= vestDuration ? 1e18 : (elapsed * 1e18 / vestDuration);
    }

    /// @notice Preview uncollected trading fees
    function previewClaim() external view returns (uint256 amount0, uint256 amount1) {
        if (!isLocked) return (0, 0);
        (,,,,,,,,,, uint128 tokensOwed0, uint128 tokensOwed1) =
            positionManager.positions(tokenId);
        return (tokensOwed0, tokensOwed1);
    }

    /// @notice Preview how many tokens vest() would return right now
    function previewVest() public view returns (uint256 amount0, uint256 amount1) {
        if (!isLocked) return (0, 0);
        uint256 pct = vestedPercent();
        if (pct == 0) return (0, 0);

        (,,,,,,, uint128 liquidity,,,,) = positionManager.positions(tokenId);
        uint128 totalVestedLiq = uint128(pct * uint256(initialLiquidity) / 1e18);
        uint128 toLiquidate = totalVestedLiq - vestedLiquidity;
        if (toLiquidate == 0) return (0, 0);

        address pool = IUniswapV3Factory(0x33128a8fC17869897dcE68Ed026d694621f6FDfD)
            .getPool(token0, token1, fee);
        uint128 totalLiquidity = IUniswapV3Pool(pool).liquidity();
        if (totalLiquidity == 0) return (0, 0);

        uint256 bal0 = IERC20(token0).balanceOf(pool);
        uint256 bal1 = IERC20(token1).balanceOf(pool);

        amount0 = (bal0 * toLiquidate) / totalLiquidity;
        amount1 = (bal1 * toLiquidate) / totalLiquidity;
    }

    /// @notice Preview what claimAndVest() would return
    function previewClaimAndVest() external view returns (uint256 fees0, uint256 fees1, uint256 vest0, uint256 vest1) {
        (fees0, fees1) = this.previewClaim();
        (vest0, vest1) = previewVest();
    }
}
