// SPDX-License-Identifier: MIT

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
