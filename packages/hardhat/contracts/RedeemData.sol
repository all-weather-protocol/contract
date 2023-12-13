// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ApolloXRedeemData} from "./vaults/apolloX/ApolloXRedeemData.sol";
import {VelaRedeemData} from "./vaults/vela/VelaRedeemData.sol";
struct RedeemData {
  uint256 amount;
  address receiver;
  ApolloXRedeemData apolloXRedeemData;
  VelaRedeemData velaRedeemData;
}
