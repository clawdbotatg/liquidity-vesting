// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import "../contracts/LiquidityVesting.sol";

contract DeployLiquidityVesting is ScaffoldETHDeploy {
    address constant POSITION_MANAGER = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    uint24 constant FEE = 10000;

    function run() external ScaffoldEthDeployerRunner {
        new LiquidityVesting(POSITION_MANAGER, WETH, CLAWD, FEE);
    }
}
