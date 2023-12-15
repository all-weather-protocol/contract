// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./vaults/apolloX/ApolloXBscVault.sol";
import "./vaults/vela/VelaBaseVault.sol";
import "./BasePortfolioV2.sol";

contract StableCoinVault is BasePortfolioV2 {
  using SafeERC20 for IERC20;

  function initialize(
    string memory name_,
    string memory symbol_
  ) public initializer {
    BasePortfolioV2._initialize(name_, symbol_);
  }
}
