// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";
import "../../3rd/apolloX/IApolloX.sol";
import "../../interfaces/AbstractVaultV2.sol";
import "../../3rd/radiant/IFeeDistribution.sol";

contract ApolloXBscVault is AbstractVaultV2 {
  using SafeERC20 for IERC20;
  using Math for uint256;

  event WithdrawFailed(address token);

  IApolloX public apolloX =
    IApolloX(0x1b6F2d3844C6ae7D56ceb3C3643b9060ba28FEb0);
  IERC20 public ALP = IERC20(0x4E47057f45adF24ba41375a175dA0357cB3480E5);
  IERC20 public constant APX =
    IERC20(0x78F5d389F5CDCcFc41594aBaB4B0Ed02F31398b3);
  IERC20 public constant USDC =
    IERC20(0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d);

  constructor(
    IERC20Metadata asset_,
    string memory name_,
    string memory symbol_
  ) ERC4626(asset_) ERC20(name_, symbol_) Ownable() {}

  function updateApolloXAddr(address newAddr) public onlyOwner {
    require(newAddr != address(0), "Address cannot be zero");
    apolloX = IApolloX(newAddr);
  }

  function updateAlpAddr(address newAddr) public onlyOwner {
    require(newAddr != address(0), "Address cannot be zero");
    ALP = IERC20(newAddr);
  }

  function totalLockedAssets() public pure override returns (uint256) {
    return 0;
  }

  function totalStakedButWithoutLockedAssets()
    public
    view
    override
    returns (uint256)
  {
    return apolloX.stakeOf(address(this));
  }

  function totalUnstakedAssets() public view override returns (uint256) {
    return IERC20(asset()).balanceOf(address(this));
  }

  function _zapIn(
    uint256 amount,
    address tokenIn,
    uint256 minAlp
  ) internal override returns (uint256) {
    IERC20 tokenInERC20 = IERC20(tokenIn);
    if (tokenIn != address(USDC)) {
      revert("Only USDC is supported for now");
    }
    uint256 currentAllowance = tokenInERC20.allowance(
      address(this),
      address(apolloX)
    );
    if (currentAllowance > 0) {
      SafeERC20.safeApprove(tokenInERC20, address(apolloX), 0);
      SafeERC20.safeApprove(ALP, address(apolloX), 0);
    }
    SafeERC20.safeApprove(tokenInERC20, address(apolloX), amount);
    SafeERC20.safeApprove(ALP, address(apolloX), amount);
    uint256 originalStakeOf = apolloX.stakeOf(address(this));
    apolloX.mintAlp(address(tokenInERC20), 100, minAlp, true);
    uint256 currentStakeOf = apolloX.stakeOf(address(this));
    uint256 mintedALPAmount = currentStakeOf - originalStakeOf;
    return mintedALPAmount;
  }

  function redeem(uint256 shares) public override {
    apolloX.unStake(shares);
    apolloX.burnAlp(address(USDC), shares, 1, msg.sender);
    super.redeem(shares, msg.sender, msg.sender);
  }

  function claim() public override {
    IFeeDistribution.RewardData[]
      memory claimableRewards = getClaimableRewards();
    if (claimableRewards.length != 0) {
      apolloX.claimAllReward();
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
    rewards[0] = IFeeDistribution.RewardData({
      token: address(APX),
      amount: Math.mulDiv(
        apolloX.pendingApx(address(this)),
        portfolioSharesInThisVault,
        totalVaultShares
      )
    });
    return rewards;
  }
}
