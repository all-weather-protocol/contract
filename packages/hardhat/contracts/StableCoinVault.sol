// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./vaults/apolloX/ApolloXBscVault.sol";
import "./BasePortfolioV2.sol";

contract StableCoinVault is BasePortfolioV2 {
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor(
    address asset_,
    string memory name_,
    string memory symbol_,
    address apolloXBscVaultAddr
  ) BasePortfolioV2(asset_, name_, symbol_) {
    require(
      apolloXBscVaultAddr != address(0),
      "apolloXBscVaultAddr cannot be zero"
    );

    vaults = [AbstractVaultV2(ApolloXBscVault(apolloXBscVaultAddr))];
  }
}
