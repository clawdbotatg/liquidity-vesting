// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./LiquidityVesting.sol";

contract LiquidityVestingFactory {
    // Base mainnet constants
    address constant POSITION_MANAGER = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    uint24 constant FEE = 10000;

    address[] public allDeployments;
    mapping(address => address[]) public deploymentsByOwner;

    event ContractDeployed(address indexed owner, address indexed contractAddress);

    function deploy(address owner) external returns (address) {
        LiquidityVesting lv = new LiquidityVesting(owner, POSITION_MANAGER, WETH, CLAWD, FEE);
        allDeployments.push(address(lv));
        deploymentsByOwner[owner].push(address(lv));
        emit ContractDeployed(owner, address(lv));
        return address(lv);
    }

    function getDeployments() external view returns (address[] memory) {
        return allDeployments;
    }

    function getDeploymentsByOwner(address owner) external view returns (address[] memory) {
        return deploymentsByOwner[owner];
    }

    function deploymentCount() external view returns (uint256) {
        return allDeployments.length;
    }
}
