// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ApolloXDepositData} from "./vaults/apolloX/ApolloXDepositData.sol";
import {VelaDepositData} from "./vaults/vela/VelaDepositData.sol";
struct DepositData {
  uint256 amount;
  address receiver;
  address tokenIn;
  address tokenInAfterSwap;
  bytes aggregatorData;
  ApolloXDepositData apolloXDepositData;
  VelaDepositData velaDepositData;
}
