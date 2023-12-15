// SPDX-License-Identifier: MIT
// 0x8c2955cb52de28222b63977481a12c80e7773407418ffa95a0507e4469ba9e64	Unstake	5327906	46 days 19 hrs ago	0x038919c63aff9c932c77a0c9c9d98eabc1a4dd08	OUT	 0xc4abade3a15064f9e3596943c699032748b13352	0 ETH	0.000013926938
// 0xd4dbd103ed32355e55168cb85040ae7d4045820d3a6fbba3d3ed8913d185bd09	Withdraw Vlp	5327891	46 days 19 hrs ago	0x038919c63aff9c932c77a0c9c9d98eabc1a4dd08	OUT	 0x00b01710c2098b883c4f93dd093be8cf605a7bde	0 ETH	0.00001014044
// 0x4b2ea2bd56248f2328838478a5c7e28aa819defa33508340287d65b00645b14c	Deposit Vlp	4624563	63 days 2 hrs ago	0x038919c63aff9c932c77a0c9c9d98eabc1a4dd08	OUT	 0x00b01710c2098b883c4f93dd093be8cf605a7bde	0 ETH	0.000010521805
// 0x9deb2ee81a0fe9fb0f109e2a168b9e24084cf3d9e812eb871402f5426dc60fe0	Approve	4624540	63 days 2 hrs ago	0x038919c63aff9c932c77a0c9c9d98eabc1a4dd08	OUT	 0xebf154ee70de5237ab07bd6428310cbc5e5c7c6e	0 ETH	0.000012746722
// 0x69487027e2705dcbb7d6615a4142b683e0eb28bd68c8f05f61c70e9e321eb9e8	Stake	4624518	63 days 2 hrs ago	0x038919c63aff9c932c77a0c9c9d98eabc1a4dd08	OUT	 0xc4abade3a15064f9e3596943c699032748b13352	0 ETH	0.000013012438
// 0x1ca0c72fcc0d6fcdab814b5a2f310f648067c48574703520851805986e394fda	Approve	4624499	63 days 2 hrs ago	0x038919c63aff9c932c77a0c9c9d98eabc1a4dd08	OUT	 Base: USDbC Token
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../3rd/vela/IVault.sol";
import "../../3rd/vela/ITokenFarm.sol";
import "../../interfaces/AbstractVaultV2.sol";
import "../../3rd/radiant/IFeeDistribution.sol";
import {DepositData} from "../../DepositData.sol";
import {RedeemData} from "../../RedeemData.sol";
import {IERC20MetadataUpgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";

contract VelaBaseVault is AbstractVaultV2 {
  using SafeERC20 for IERC20;

  IVault public VelaVault;
  ITokenFarm public VelaFarm;
  IERC20 public VLP;
  IERC20 public constant USDbC =
    IERC20(0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA);

  function initialize(
    IERC20MetadataUpgradeable asset_,
    string memory name_,
    string memory symbol_,
    uint256 ratioAfterPerformanceFee_,
    uint256 denominator_
  ) public initializer {
    AbstractVaultV2._initialize(
      asset_,
      name_,
      symbol_,
      ratioAfterPerformanceFee_,
      denominator_
    );

    VelaVault = IVault(0xC4ABADE3a15064F9E3596943c699032748b13352);
    VelaFarm = ITokenFarm(0x00B01710c2098b883C4F93dD093bE8Cf605a7BDe);
    VLP = IERC20(0xEBf154Ee70de5237aB07Bd6428310CbC5e5c7C6E);
  }

  function updateVelaAddr(
    address newAddr,
    address newAddr2,
    address newVlpAddr
  ) public onlyOwner {
    require(newAddr != address(0), "Address cannot be zero");
    require(newAddr2 != address(0), "newAddr2 cannot be zero");
    VelaVault = IVault(newAddr);
    VelaFarm = ITokenFarm(newAddr2);
    VLP = IERC20(newVlpAddr);
  }

  function updateVlpAddr(address newAddr) public onlyOwner {
    require(newAddr != address(0), "Address cannot be zero");
    VLP = IERC20(newAddr);
  }

  function totalLockedAssets() public pure override returns (uint256) {
    // need to check the cooldown
    return 0;
  }

  function totalStakedButWithoutLockedAssets()
    public
    view
    override
    returns (uint256)
  {
    (uint256 stakedVlpAmount, ) = VelaFarm.getStakedVLP(address(this));
    return stakedVlpAmount;
  }

  function claim() public override nonReentrant whenNotPaused {
    IFeeDistribution.RewardData[]
      memory claimableRewards = getClaimableRewards();
    if (claimableRewards.length != 0) {
      VelaFarm.harvestMany(true, true, true, true);
      super.claimRewardsFromVaultToPortfolioVault(claimableRewards);
    }
  }

  function getClaimableRewards()
    public
    view
    override
    returns (IFeeDistribution.RewardData[] memory rewards)
  {
    // pro rata: user's share divided by total shares, is the ratio of the reward
    uint256 portfolioSharesInThisVault = balanceOf(msg.sender);
    uint256 totalVaultShares = totalSupply();
    // slither-disable-next-line incorrect-equality
    if (portfolioSharesInThisVault == 0 || totalVaultShares == 0) {
      return new IFeeDistribution.RewardData[](0);
    }
    rewards = new IFeeDistribution.RewardData[](1);

    (address[] memory addresses, , , uint256[] memory amounts) = VelaFarm
      .pendingTokens(false, address(this));
    address esVELA = addresses[0];
    uint256 esVelaAmount = amounts[0];
    uint256 claimableRewardsBelongsToThisPortfolio = Math.mulDiv(
      esVelaAmount,
      portfolioSharesInThisVault,
      totalVaultShares
    );
    rewards[0] = IFeeDistribution.RewardData({
      token: esVELA,
      amount: _calClaimableAmountAfterPerformanceFee(
        claimableRewardsBelongsToThisPortfolio
      )
    });
    return rewards;
  }

  function _zapIn(
    uint256 amount,
    DepositData calldata depositData
  ) internal override returns (uint256) {
    // mint
    IERC20 tokenInERC20 = IERC20(depositData.velaDepositData.tokenIn);
    SafeERC20.forceApprove(tokenInERC20, address(VelaVault), amount);
    uint256 originalVlpBalance = VLP.balanceOf(address(this));
    VelaVault.stake(address(this), depositData.velaDepositData.tokenIn, amount);
    uint256 currentVlpBalance = VLP.balanceOf(address(this));
    uint256 mintedVLPAmount = currentVlpBalance - originalVlpBalance;

    // stake
    SafeERC20.forceApprove(VLP, address(VelaFarm), mintedVLPAmount);
    VelaFarm.depositVlp(mintedVLPAmount);
    return mintedVLPAmount;
  }

  function _redeemFrom3rdPartyProtocol(
    uint256 shares,
    RedeemData calldata redeemData
  ) internal override returns (uint256, address, address, bytes calldata) {
    VelaFarm.withdrawVlp(shares);

    uint256 originalTokenOutBalance = IERC20(
      redeemData.velaRedeemData.vlpTokenOut
    ).balanceOf(address(this));
    VelaVault.unstake(redeemData.velaRedeemData.vlpTokenOut, shares);
    uint256 currentTokenOutBalance = IERC20(
      redeemData.velaRedeemData.vlpTokenOut
    ).balanceOf(address(this));
    uint256 redeemAmount = currentTokenOutBalance - originalTokenOutBalance;
    SafeERC20.safeTransfer(
      IERC20(redeemData.velaRedeemData.vlpTokenOut),
      msg.sender,
      redeemAmount
    );
    return (
      redeemAmount,
      redeemData.velaRedeemData.vlpTokenOut,
      redeemData.velaRedeemData.tokenOut,
      redeemData.velaRedeemData.aggregatorData
    );
  }
}
