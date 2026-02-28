import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

const externalContracts = {
  8453: {
    WETH: {
      address: "0x4200000000000000000000000000000000000006" as `0x${string}`,
      abi: [
        {
          name: "balanceOf",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          name: "approve",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
        {
          name: "allowance",
          type: "function",
          stateMutability: "view",
          inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
          ],
          outputs: [{ name: "", type: "uint256" }],
        },
        { name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] },
      ],
    },
    CLAWD: {
      address: "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as `0x${string}`,
      abi: [
        {
          name: "balanceOf",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          name: "approve",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
        {
          name: "allowance",
          type: "function",
          stateMutability: "view",
          inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
          ],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
    },
    UniswapV3Pool: {
      address: "0xCD55381a53da35Ab1D7Bc5e3fE5F76cac976FAc3" as `0x${string}`,
      abi: [
        {
          name: "slot0",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [
            { name: "sqrtPriceX96", type: "uint160" },
            { name: "tick", type: "int24" },
            { name: "observationIndex", type: "uint16" },
            { name: "observationCardinality", type: "uint16" },
            { name: "observationCardinalityNext", type: "uint16" },
            { name: "feeProtocol", type: "uint8" },
            { name: "unlocked", type: "bool" },
          ],
        },
      ],
    },
    NonfungiblePositionManager: {
      address: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1" as `0x${string}`,
      abi: [
        {
          name: "mint",
          type: "function",
          stateMutability: "payable",
          inputs: [
            {
              name: "params",
              type: "tuple",
              components: [
                { name: "token0", type: "address" },
                { name: "token1", type: "address" },
                { name: "fee", type: "uint24" },
                { name: "tickLower", type: "int24" },
                { name: "tickUpper", type: "int24" },
                { name: "amount0Desired", type: "uint256" },
                { name: "amount1Desired", type: "uint256" },
                { name: "amount0Min", type: "uint256" },
                { name: "amount1Min", type: "uint256" },
                { name: "recipient", type: "address" },
                { name: "deadline", type: "uint256" },
              ],
            },
          ],
          outputs: [
            { name: "tokenId", type: "uint256" },
            { name: "liquidity", type: "uint128" },
            { name: "amount0", type: "uint256" },
            { name: "amount1", type: "uint256" },
          ],
        },
      ],
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
