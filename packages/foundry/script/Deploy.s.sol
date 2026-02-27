//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import { DeployLiquidityVesting } from "./DeployLiquidityVesting.s.sol";

contract DeployScript is ScaffoldETHDeploy {
  function run() external {
    DeployLiquidityVesting deployLiquidityVesting = new DeployLiquidityVesting();
    deployLiquidityVesting.run();
  }
}
