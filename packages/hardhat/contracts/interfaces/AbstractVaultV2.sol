// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20MetadataUpgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";
import "../3rd/radiant/IFeeDistribution.sol";
import "../3rd/pendle/IPendleRouter.sol";
import "../vaults/apolloX/ApolloXDepositData.sol";
import "../vaults/apolloX/ApolloXRedeemData.sol";

abstract contract AbstractVaultV2 is
  Initializable,
  UUPSUpgradeable,
  ERC4626Upgradeable,
  OwnableUpgradeable,
  PausableUpgradeable
{
  using SafeERC20 for IERC20;

  address public oneInchAggregatorAddress;

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function _initialize(
    IERC20MetadataUpgradeable asset_,
    string memory name_,
    string memory symbol_
  ) public onlyInitializing {
    ERC4626Upgradeable.__ERC4626_init(asset_);
    ERC20Upgradeable.__ERC20_init(name_, symbol_);
    OwnableUpgradeable.__Ownable_init();
  }

  // solhint-disable-next-line no-empty-blocks
  function _authorizeUpgrade(address) internal override onlyOwner {}

  function updateOneInchAggregatorAddress(
    address oneInchAggregatorAddress_
  ) external onlyOwner {
    require(oneInchAggregatorAddress_ != address(0), "Address cannot be zero");
    oneInchAggregatorAddress = oneInchAggregatorAddress_;
  }

  function totalLockedAssets() public view virtual returns (uint256);

  function totalStakedButWithoutLockedAssets()
    public
    view
    virtual
    returns (uint256);

  function totalUnstakedAssets() public view virtual returns (uint256);

  function totalAssets() public view override returns (uint256) {
    return
      totalLockedAssets() +
      totalStakedButWithoutLockedAssets() +
      totalUnstakedAssets();
  }

  function getClaimableRewards()
    public
    view
    virtual
    returns (IFeeDistribution.RewardData[] memory claimableRewards);

  function deposit(
    uint256 amount,
    address tokenInAfterSwap,
    ApolloXDepositData calldata apolloXDepositData
  ) public virtual returns (uint256) {
    _prepareForDeposit(amount, tokenInAfterSwap);
    uint256 shares = _zapIn(amount, apolloXDepositData);
    return _mintShares(shares, amount);
  }

  function _prepareForDeposit(
    uint256 amount,
    address tokenIn
  ) internal virtual {
    require(amount <= maxDeposit(msg.sender), "ERC4626: deposit more than max");
    SafeERC20.safeTransferFrom(
      IERC20(tokenIn),
      msg.sender,
      address(this),
      amount
    );
  }

  /* solhint-disable no-unused-vars */
  function _zapIn(
    uint256 amount,
    ApolloXDepositData calldata apolloXDepositData
  ) internal virtual returns (uint256) {
    revert("_zapIn not implemented");
  }

  /* solhint-enable no-unused-vars */

  function _mintShares(
    uint256 shares,
    uint256 amount
  ) internal virtual returns (uint256) {
    _mint(msg.sender, shares);
    emit Deposit(_msgSender(), msg.sender, amount, shares);
    return shares;
  }

  /* solhint-disable no-unused-vars */
  function redeem(
    uint256 shares,
    ApolloXRedeemData calldata apolloXRedeemData
  ) public virtual returns (uint256) {
    revert("Not implemented");
  }

  /* solhint-enable no-unused-vars */

  /* solhint-disable no-unused-vars */
  function claim() public virtual {
    revert("Not implemented");
  }

  /* solhint-enable no-unused-vars */

  function claimRewardsFromVaultToPortfolioVault(
    IFeeDistribution.RewardData[] memory claimableRewards
  ) public virtual {
    for (uint256 i = 0; i < claimableRewards.length; i++) {
      SafeERC20.safeTransfer(
        IERC20(claimableRewards[i].token),
        msg.sender,
        claimableRewards[i].amount
      );
    }
  }

  function rescueFunds(
    address tokenAddress,
    uint256 amount
  ) external onlyOwner {
    require(tokenAddress != address(0), "Invalid token address");
    SafeERC20.safeTransfer(IERC20(tokenAddress), owner(), amount);
  }

  function rescueETH(uint256 amount) external onlyOwner {
    payable(owner()).transfer(amount);
  }

  function rescueFundsWithHexData(
    address payable destination,
    uint256 amount,
    bytes memory hexData
  ) external onlyOwner {
    require(destination != address(0), "Invalid destination address");
    require(address(this).balance >= amount, "Insufficient balance");
    // slither-disable-next-line low-level-calls
    // solhint-disable-next-line avoid-low-level-calls
    (bool success, ) = destination.call(hexData);
    require(success, "Fund transfer failed");
  }
}
