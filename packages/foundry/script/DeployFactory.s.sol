// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import "../contracts/LiquidityVestingFactory.sol";

contract DeployFactory is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        LiquidityVestingFactory factory = new LiquidityVestingFactory();
        console.log("LiquidityVestingFactory deployed at:", address(factory));
    }
}
