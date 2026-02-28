# 🦞 Liquidity Vesting

Lock WETH + CLAWD into a Uniswap V3 full-range position and linearly vest liquidity back to the owner over a configurable duration.

## Contracts

- **LiquidityVesting** (Base mainnet): `0x5d313662ccc366f2dd31ee367f11cbb79bb3e5c5`
- **Uniswap V3 Pool** (WETH/CLAWD 1%): `0xCD55381a53da35Ab1D7Bc5e3fE5F76cac976FAc3`

## How It Works

1. Owner approves WETH + CLAWD to the contract
2. `lockUp(amount0, amount1, vestDuration)` — creates a full-range Uniswap V3 LP position
3. Over `vestDuration` seconds, liquidity linearly unlocks
4. `vest()` — withdraws vested liquidity back to the owner
5. `claim()` — collects accumulated trading fees
6. `claimAndVest()` — does both in one tx

## Frontend

Built with Scaffold-ETH 2 (Next.js + Wagmi + RainbowKit). Deployed to IPFS via BGIPFS.

## Development

```bash
cd packages/nextjs
yarn install
yarn start
```

## License

MIT
