// SPDX-License-Identifier: MIT

import {ApolloXRedeemData} from "./vaults/apolloX/ApolloXRedeemData.sol";
import {VelaRedeemData} from "./vaults/vela/VelaRedeemData.sol";
struct RedeemData {
  uint256 amount;
  address receiver;
  ApolloXRedeemData apolloXRedeemData;
  VelaRedeemData velaRedeemData;
}
