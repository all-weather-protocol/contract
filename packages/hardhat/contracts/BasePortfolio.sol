// SPDX-License-Identifier: MIT
// The code defines a Solidity contract called AllWeatherPortfolioLPToken that inherits from ERC20. It takes in several parameters on construction, including asset, radiantVaultAddr, and dpxVaultAddr. The contract has several functions that do the following:

// deposit: Takes in an amount and transfers tokens of asset from the user to the contract, then distributes the asset into two protocols (DPX and Radiant) based on a portfolioAllocation. The user receives an ERC20 token (AWVLP) in proportion to their deposit.
// redeem: Takes in a number of shares and an account, then redeems all DPX LP Tokens and sends them to the account. Only DPX LP tokens are redeemed. The proportion of redeemed tokens is distributed to the sender's ERC20 tokens (AWVLP).
// claimableRewards: Takes in an account, calculates the user's claimable rewards across both protocols and returns them.
// claim: Takes in an account and reward tokens, and claims all the available rewards across both protocols, sending them to the account.
// The code imports several open source libraries and uses various data structures like struct, bytes, and mapping. The SPDX-License-Identifier specifies the license for the code (MIT in this case).

pragma solidity ^0.8.21;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./vaults/radiant/RadiantArbitrumVault.sol";
import "./vaults/dopex/DpxArbitrumVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./radiant/IFeeDistribution.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./pendle/IPendleRouter.sol";
import "./vaults/equilibria/EquilibriaGlpVault.sol";
import "./vaults/equilibria/EquilibriaGDAIVault.sol";
import "./interfaces/AbstractVault.sol";

contract BasePortfolio is ERC20, Ownable {
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  struct PortfolioAllocationOfSingleCategory {
    string protocol;
    uint256 percentage;
  }
  struct ClaimableRewardOfAProtocol {
    string protocol;
    IFeeDistribution.RewardData[] claimableRewards;
  }

  struct SharesOfVault {
    string vaultName;
    uint256 assets;
  }

  struct DepositData {
    uint256 amount;
    address receiver;
    bytes oneInchDataDpx;
    uint256 glpMinLpOut;
    IPendleRouter.ApproxParams glpGuessPtReceivedFromSy;
    IPendleRouter.TokenInput glpInput;
    uint256 gdaiMinLpOut;
    IPendleRouter.ApproxParams gdaiGuessPtReceivedFromSy;
    IPendleRouter.TokenInput gdaiInput;
    bytes gdaiOneInchDataGDAI;
    uint256 rethMinLpOut;
    IPendleRouter.ApproxParams rethGuessPtReceivedFromSy;
    IPendleRouter.TokenInput rethInput;
    bytes rethOneInchDataRETH;
  }

  IERC20 public immutable asset;
  uint256 public balanceOfProtocolFee;

  mapping(string => uint256) public portfolioAllocation;
  AbstractVault[] internal vaults;
  mapping(address => mapping(string => mapping(address => uint256)))
    public userRewardsOfInvestedProtocols;
  mapping(address => mapping(string => mapping(address => uint256)))
    public userRewardPerTokenPaid;
  mapping(string => mapping(address => uint256)) public rewardPerShareZappedIn;
  uint256 public immutable unitOfShares = 10e15;

  constructor(
    address asset_,
    string memory name_,
    string memory symbol
  ) ERC20(name_, symbol) {
    asset = ERC20(asset_);
  }

  function getVaults() external view returns (AbstractVault[] memory) {
    return vaults;
  }

  modifier updateRewards() {
    // pretty much copied from https://solidity-by-example.org/defi/staking-rewards/
    ClaimableRewardOfAProtocol[]
      memory totalClaimableRewards = getClaimableRewards(
        payable(address(this))
      );
    for (
      uint256 vaultIdx = 0;
      vaultIdx < totalClaimableRewards.length;
      vaultIdx++
    ) {
      for (
        uint256 rewardIdxOfThisVault = 0;
        rewardIdxOfThisVault <
        totalClaimableRewards[vaultIdx].claimableRewards.length;
        rewardIdxOfThisVault++
      ) {
        _updateSpecificReward(
          totalClaimableRewards[vaultIdx].protocol,
          totalClaimableRewards[vaultIdx].claimableRewards[rewardIdxOfThisVault]
        );
      }
      // empty the claimable rewards in these vaults, so that we won't re-calculate the `amount` back to `_updateSpecificReward()`
      vaults[vaultIdx].claim();
    }
    _;
  }

  function setVaultAllocations(
    PortfolioAllocationOfSingleCategory[] calldata portfolioAllocation_
  ) public onlyOwner {
    for (uint256 i = 0; i < portfolioAllocation_.length; i++) {
      portfolioAllocation[
        portfolioAllocation_[i].protocol
      ] = portfolioAllocation_[i].percentage;
    }
  }

  function getPortfolioAllocation()
    public
    view
    returns (string[] memory, uint256[] memory)
  {
    string[] memory nameOfVaults = new string[](vaults.length);
    uint256[] memory percentages = new uint256[](vaults.length);
    for (uint256 i = 0; i < vaults.length; i++) {
      nameOfVaults[i] = vaults[i].name();
      percentages[i] = portfolioAllocation[vaults[i].name()];
    }
    return (nameOfVaults, percentages);
  }

  function totalAssets() public view returns (SharesOfVault[] memory) {
    SharesOfVault[] memory shareOfVaults = new SharesOfVault[](vaults.length);
    for (uint256 i = 0; i < vaults.length; i++) {
      shareOfVaults[i].vaultName = vaults[i].name();
      shareOfVaults[i].assets = vaults[i].totalAssets();
    }
    return shareOfVaults;
  }

  function deposit(DepositData calldata depositData) public updateRewards {
    require(depositData.amount > 0, "amount must > 0");

    // Transfer tokens from the user to the contract
    SafeERC20.safeTransferFrom(
      IERC20(asset),
      msg.sender,
      address(this),
      depositData.amount
    );
    uint256 amountAfterDeductingFee = _getAmountAfterDeductingFee(
      depositData.amount
    );

    for (uint256 idx = 0; idx < vaults.length; idx++) {
      bytes32 bytesOfvaultName = keccak256(bytes(vaults[idx].name()));
      uint256 zapInAmountForThisVault = Math.mulDiv(
        amountAfterDeductingFee,
        portfolioAllocation[vaults[idx].name()],
        100
      );
      if (zapInAmountForThisVault == 0) {
        continue;
      }
      SafeERC20.safeApprove(
        IERC20(asset),
        address(vaults[idx]),
        zapInAmountForThisVault
      );

      if (bytesOfvaultName == keccak256(bytes("SushSwap-DpxETH"))) {
        require(
          vaults[idx].deposit(
            zapInAmountForThisVault,
            depositData.oneInchDataDpx
          ) > 0,
          "Buying Dpx LP token failed"
        );
      } else if (bytesOfvaultName == keccak256(bytes("RadiantArbitrum-DLP"))) {
        require(
          vaults[idx].deposit(zapInAmountForThisVault) > 0,
          "Buying Radiant LP token failed"
        );
      } else if (bytesOfvaultName == keccak256(bytes("Equilibria-GLP"))) {
        require(
          vaults[idx].deposit(
            zapInAmountForThisVault,
            depositData.glpMinLpOut,
            depositData.glpGuessPtReceivedFromSy,
            depositData.glpInput
          ) > 0,
          "Zap Into Equilibria GLP failed"
        );
      } else if (bytesOfvaultName == keccak256(bytes("Equilibria-GDAI"))) {
        // commonly occurs error
        // Error: VM Exception while processing transaction: reverted with reason string 'Dai/insufficient-balance'
        // In short, you need to lower the amount of Dai that you zapin to getPendleZapInData()
        // since there's 2 steps: weth -> dai -> gdai
        // so slippage is the culprit to get this error
        require(
          vaults[idx].deposit(
            zapInAmountForThisVault,
            depositData.gdaiOneInchDataGDAI,
            depositData.gdaiMinLpOut,
            depositData.gdaiGuessPtReceivedFromSy,
            depositData.gdaiInput
          ) > 0,
          "Zap Into Equilibria GDAI failed"
        );
      } else if (bytesOfvaultName == keccak256(bytes("Equilibria-RETH"))) {
        require(
          vaults[idx].deposit(
            zapInAmountForThisVault,
            depositData.rethOneInchDataRETH,
            depositData.rethMinLpOut,
            depositData.rethGuessPtReceivedFromSy,
            depositData.rethInput
          ) > 0,
          "Zap Into Equilibria RETH failed"
        );
      }
    }

    _mint(
      depositData.receiver,
      SafeMath.div(amountAfterDeductingFee, unitOfShares)
    );
    emit Transfer(
      address(0),
      depositData.receiver,
      SafeMath.div(amountAfterDeductingFee, unitOfShares)
    );
  }

  function redeemAndClaim(
    uint256 shares,
    address payable receiver
  ) public updateRewards {
    redeem(shares, receiver);
  }

  function redeem(
    uint256 shares,
    address payable receiver
  ) public updateRewards {
    require(shares <= totalSupply(), "Shares exceed total supply");
    claim(receiver);
    for (uint256 i = 0; i < vaults.length; i++) {
      uint256 vaultShares = Math.mulDiv(
        vaults[i].balanceOf(address(this)),
        shares,
        totalSupply()
      );
      bytes32 bytesOfvaultName = keccak256(bytes(vaults[i].name()));
      if (vaultShares > 0) {
        if (bytesOfvaultName == keccak256(bytes("RadiantArbitrum-DLP"))) {
          vaults[i].redeem();
        } else {
          vaults[i].redeem(vaultShares);
        }
        SafeERC20.safeTransfer(
          IERC20(vaults[i].asset()),
          receiver,
          vaultShares
        );
      }
    }
    _burn(msg.sender, shares);
  }

  function claim(address payable receiver) public updateRewards {
    ClaimableRewardOfAProtocol[]
      memory totalClaimableRewards = getClaimableRewards(payable(msg.sender));
    uint256 userShares = balanceOf(msg.sender);
    if (userShares == 0) {
      return;
    }
    for (
      uint256 vaultIdx = 0;
      vaultIdx < totalClaimableRewards.length;
      vaultIdx++
    ) {
      string memory protocolNameOfThisVault = totalClaimableRewards[vaultIdx]
        .protocol;
      for (
        uint256 rewardIdxOfThisVault = 0;
        rewardIdxOfThisVault <
        totalClaimableRewards[vaultIdx].claimableRewards.length;
        rewardIdxOfThisVault++
      ) {
        address addressOfReward = totalClaimableRewards[vaultIdx]
          .claimableRewards[rewardIdxOfThisVault]
          .token;
        SafeERC20.safeTransfer(
          IERC20(addressOfReward),
          receiver,
          userRewardsOfInvestedProtocols[msg.sender][protocolNameOfThisVault][
            addressOfReward
          ]
        );
        userRewardsOfInvestedProtocols[msg.sender][protocolNameOfThisVault][
          addressOfReward
        ] = 0;
      }
    }
  }

  function getClaimableRewards(
    address payable owner
  ) public view returns (ClaimableRewardOfAProtocol[] memory) {
    ClaimableRewardOfAProtocol[]
      memory totalClaimableRewards = new ClaimableRewardOfAProtocol[](
        vaults.length
      );
    for (uint256 vaultIdx = 0; vaultIdx < vaults.length; vaultIdx++) {
      string memory protocolNameOfThisVault = vaults[vaultIdx].name();
      IFeeDistribution.RewardData[] memory claimableRewardsOfThisVault = vaults[
        vaultIdx
      ].getClaimableRewards();
      IFeeDistribution.RewardData[]
        memory claimableRewardsOfThisVaultArr = new IFeeDistribution.RewardData[](
          claimableRewardsOfThisVault.length
        );
      for (
        uint256 rewardIdx = 0;
        rewardIdx < claimableRewardsOfThisVault.length;
        rewardIdx++
      ) {
        address addressOfReward = claimableRewardsOfThisVault[rewardIdx].token;
        claimableRewardsOfThisVaultArr[rewardIdx] = IFeeDistribution
          .RewardData({
            token: addressOfReward,
            amount: _getRewardAmount(
              owner,
              claimableRewardsOfThisVault[rewardIdx].amount,
              protocolNameOfThisVault,
              addressOfReward
            )
          });
      }
      totalClaimableRewards[vaultIdx] = ClaimableRewardOfAProtocol({
        protocol: protocolNameOfThisVault,
        claimableRewards: claimableRewardsOfThisVaultArr
      });
    }
    return totalClaimableRewards;
  }

  function claimProtocolFee() external onlyOwner {
    SafeERC20.safeTransfer(asset, msg.sender, balanceOfProtocolFee);
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

  function _getRewardAmount(
    address payable owner,
    uint256 claimableRewardsAmountOfThisVault,
    string memory protocolNameOfThisVault,
    address addressOfReward
  ) internal view returns (uint256) {
    uint256 rewardAmount;
    if (owner == address(this)) {
      rewardAmount = claimableRewardsAmountOfThisVault;
    } else {
      rewardAmount =
        balanceOf(owner) *
        (rewardPerShareZappedIn[protocolNameOfThisVault][addressOfReward] +
          _calculateRewardPerShareDuringThisPeriod(
            claimableRewardsAmountOfThisVault
          ) -
          userRewardPerTokenPaid[owner][protocolNameOfThisVault][
            addressOfReward
          ]) +
        userRewardsOfInvestedProtocols[owner][protocolNameOfThisVault][
          addressOfReward
        ];
    }
    return rewardAmount;
  }

  function _updateSpecificReward(
    string memory protocolNameOfThisVault,
    IFeeDistribution.RewardData memory claimableReward
  ) internal {
    if (msg.sender != address(0)) {
      address addressOfReward = claimableReward.token;
      uint256 oneOfTheUnclaimedRewardsBelongsToThisPortfolio = claimableReward
        .amount;
      rewardPerShareZappedIn[protocolNameOfThisVault][
        addressOfReward
      ] += _calculateRewardPerShareDuringThisPeriod(
        oneOfTheUnclaimedRewardsBelongsToThisPortfolio
      );
      userRewardsOfInvestedProtocols[msg.sender][protocolNameOfThisVault][
        addressOfReward
      ] += _calcualteUserEarnedBeforeThisUpdateAction(
        protocolNameOfThisVault,
        addressOfReward
      );
      userRewardPerTokenPaid[msg.sender][protocolNameOfThisVault][
        addressOfReward
      ] = rewardPerShareZappedIn[protocolNameOfThisVault][addressOfReward];
    }
  }

  function _calcualteUserEarnedBeforeThisUpdateAction(
    string memory protocolNameOfThisVault,
    address addressOfReward
  ) public view returns (uint256) {
    return
      (rewardPerShareZappedIn[protocolNameOfThisVault][addressOfReward] -
        userRewardPerTokenPaid[msg.sender][protocolNameOfThisVault][
          addressOfReward
        ]) * balanceOf(msg.sender);
  }

  function _calculateRewardPerShareDuringThisPeriod(
    uint256 oneOfTheUnclaimedRewardsBelongsToThisPortfolio
  ) internal view returns (uint256) {
    if (totalSupply() == 0) {
      return 0;
    }
    return
      SafeMath.div(
        oneOfTheUnclaimedRewardsBelongsToThisPortfolio,
        totalSupply()
      );
  }

  function _getAmountAfterDeductingFee(
    uint256 depositAmount
  ) internal returns (uint256) {
    uint256 protocolFee = Math.mulDiv(depositAmount, 3, 1000);
    balanceOfProtocolFee += protocolFee;
    return depositAmount - protocolFee;
  }

  // solhint-disable-next-line no-empty-blocks
  receive() external payable {}
}
