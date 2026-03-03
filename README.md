# 🦞 Liquidity Vesting

Lock WETH + CLAWD into a Uniswap V3 concentrated liquidity position and linearly vest liquidity back to the owner over a configurable duration. While locked, the position earns swap fees.

A factory contract lets anyone deploy their own independent LiquidityVesting instance from the same frontend.

## Live App

**https://liquidityvesting.clawdbotatg.eth.link/**

## Contracts (Base Mainnet)

- **LiquidityVestingFactory**: [`0xEE3B3c6DF763340356F8783F67d4b64E48b3A018`](https://basescan.org/address/0xEE3B3c6DF763340356F8783F67d4b64E48b3A018) — deploys new LiquidityVesting instances
- **LiquidityVesting v7** (reference instance): [`0x7916773e871a832ae2b6046b0f964a078dc67ab4`](https://basescan.org/address/0x7916773e871a832ae2b6046b0f964a078dc67ab4)
- **Owner**: `0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0` (safe.clawd.atg.eth — 3/6 multisig)
- **WETH (token0)**: `0x4200000000000000000000000000000000000006`
- **CLAWD (token1)**: `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`
- **Uniswap V3 Pool** (WETH/CLAWD 1%): `0xCD55381a53da35Ab1D7Bc5e3fE5F76cac976FAc3`
- **Uniswap V3 NonfungiblePositionManager**: `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1`

## How It Works

1. Deploy a personal LiquidityVesting contract via the factory (front page of the app)
2. Approve WETH + CLAWD to your contract
3. `lockUp(amount0Desired, amount1Desired, vestDuration, tickLower, tickUpper, amount0Min, amount1Min)` — creates a Uniswap V3 LP position at the specified tick range and starts the vest timer
4. Over `vestDuration` seconds, liquidity linearly unlocks
5. `vest()` — withdraws vested liquidity back to the owner
6. `claim()` — collects accumulated trading fees
7. `claimAndVest()` — does both atomically
8. `previewVest()` / `previewClaim()` — view functions for accurate tick-aware estimates

## Key Details

- **Default full-range ticks**: tickLower = -887200, tickUpper = 887200 (custom range also supported)
- **Slippage**: 5% on lockUp, vest, and claimAndVest
- **Security**: renounceOwnership disabled, sweep guards, isLocked guards, state cleared after final vest
- **Solc**: pinned to 0.8.26 (via-ir optimizer bug in newer versions affects sequential vest math)

## Frontend

Built with Scaffold-ETH 2 (Next.js + Wagmi + RainbowKit).

- `/` — deploy a new LiquidityVesting contract via the factory
- `/address?contract=0x...` — manage an existing contract (lock, approve, vest, claim)

## Development

```bash
# Start local chain
export PATH="$HOME/.foundry/bin:$PATH"
anvil &

# Deploy locally
forge script packages/foundry/script/DeployLiquidityVesting.s.sol \
  --rpc-url localhost \
  --account scaffold-eth-default \
  --password localhost \
  --broadcast --ffi
node packages/foundry/scripts-js/generateTsAbis.js

# Start frontend
cd packages/nextjs
yarn install
yarn start
```

## IPFS Deployment

```bash
cd packages/nextjs
rm -rf out .next
NEXT_PUBLIC_PRODUCTION_URL="https://liquidityvesting.clawdbotatg.eth.link" \
  NODE_OPTIONS="--require ./polyfill-localstorage.cjs" \
  NEXT_PUBLIC_IPFS_BUILD=true \
  NEXT_PUBLIC_IGNORE_BUILD_ERROR=true \
  yarn build
yarn bgipfs upload out
```

## License

MIT
