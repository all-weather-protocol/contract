// SPDX-License-Identifier: MIT
// 1. LP token has shares of radiant vault
// 2. shoudl have lp token
// 3. all weather vault is erc4626

pragma solidity ^0.8.4;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./RadiantArbitrumVault.sol";
import "./DpxArbitrumVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./radiant/IFeeDistribution.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract AllWeatherPortfolioLPToken is ERC20 {
  using SafeERC20 for IERC20;
  struct PortfolioAllocationOfSingleCategory {
    string protocol;
    uint256 percentage;
  }
  struct ClaimableRewardOfAProtocol {
    string protocol;
    IFeeDistribution.RewardData[] claimableRewards;
  }

  IERC20 public immutable asset;
  address public radiantVaultAddr;
  address payable public dpxVaultAddr;

  constructor(
    address asset_,
    address radiantVaultAddr_,
    address payable dpxVaultAddr_
  ) ERC20("AllWeatherVaultLP", "AWVLP") {
    radiantVaultAddr = radiantVaultAddr_;
    dpxVaultAddr = dpxVaultAddr_;
    asset = ERC20(asset_);
  }

  // function deposit(uint256 amount, PortfolioAllocationOfSingleCategory[] portfolioAllocation) public {
  function deposit(uint256 amount, bytes calldata oneInchData) public {
    PortfolioAllocationOfSingleCategory[]
      memory portfolioAllocation = new PortfolioAllocationOfSingleCategory[](1);
    portfolioAllocation[0] = PortfolioAllocationOfSingleCategory({
      protocol: "dpx",
      percentage: 50
    });
    // portfolioAllocation[1] = PortfolioAllocationOfSingleCategory({ protocol: "radiant", percentage: 50 });
    // PortfolioAllocationOfSingleCategory[] memory portfolioAllocation = [
    //     PortfolioAllocationOfSingleCategory({ protocol: "dpx", percentage: 50 }),
    //     // PortfolioAllocationOfSingleCategory({ protocol: "radiant", percentage: 50 })
    // ];
    require(amount > 0, "Token amount must be greater than 0");
    // Transfer tokens from the user to the contract
    SafeERC20.safeTransferFrom(
      IERC20(asset),
      msg.sender,
      address(this),
      amount
    );
    for (uint idx = 0; idx < portfolioAllocation.length; idx++) {
      bytes32 protocolHash = keccak256(
        bytes(portfolioAllocation[idx].protocol)
      );
      if (protocolHash == keccak256(bytes("dpx"))) {
        SafeERC20.safeApprove(IERC20(asset), dpxVaultAddr, amount);
        require(
          DpxArbitrumVault(dpxVaultAddr).deposit(
            amount,
            address(this),
            oneInchData
          ) > 0,
          "Buying Dpx LP token failed"
        );
      } else if (protocolHash == keccak256(bytes("radiant"))) {
        SafeERC20.safeApprove(IERC20(asset), radiantVaultAddr, amount);
        require(
          RadiantArbitrumVault(radiantVaultAddr).deposit(
            amount,
            address(this),
            oneInchData
          ) > 0,
          "Buying Radiant LP token failed"
        );
      }
    }

    // Mint tokens to the user making the deposit
    _mint(msg.sender, amount);
    emit Transfer(address(0), msg.sender, amount);
  }

  function redeemAll(uint256 shares, address receiver) public {
    uint256 dpxShares = Math.mulDiv(
      DpxArbitrumVault(dpxVaultAddr).balanceOf(address(this)),
      shares,
      totalSupply()
    );
    DpxArbitrumVault(dpxVaultAddr).redeemAll(dpxShares, receiver);
    // RadiantArbitrumVault(radiantVaultAddr).redeemAll(shares, receiver);
    _burn(msg.sender, shares);
  }

  function claim(address receiver, address[] memory rRewardTokens) public {
    ClaimableRewardOfAProtocol[]
      memory totalClaimableRewards = claimableRewards(receiver);
    for (uint idx = 0; idx < totalClaimableRewards.length; idx++) {
      bytes32 protocolHash = keccak256(
        bytes(totalClaimableRewards[idx].protocol)
      );
      if (protocolHash == keccak256(bytes("dpx"))) {
        DpxArbitrumVault(dpxVaultAddr).claim(
          receiver,
          totalClaimableRewards[idx].claimableRewards
        );
      } else if (protocolHash == keccak256(bytes("radiant"))) {
        RadiantArbitrumVault(radiantVaultAddr).claim(
          receiver,
          totalClaimableRewards[idx].claimableRewards,
          rRewardTokens
        );
      }
    }
  }

  function claimableRewards(
    address receiver
  ) public view returns (ClaimableRewardOfAProtocol[] memory) {
    uint256 userShares = balanceOf(msg.sender);
    uint256 portfolioShares = totalSupply();
    if (userShares == 0 || portfolioShares == 0) {
      return new ClaimableRewardOfAProtocol[](0);
    }

    ClaimableRewardOfAProtocol[]
      memory totalClaimableRewards = new ClaimableRewardOfAProtocol[](2);
    totalClaimableRewards[0] = ClaimableRewardOfAProtocol({
      protocol: "dpx",
      claimableRewards: DpxArbitrumVault(dpxVaultAddr).claimableRewards(
        receiver,
        userShares,
        portfolioShares
      )
    });
    totalClaimableRewards[1] = ClaimableRewardOfAProtocol({
      protocol: "radiant",
      claimableRewards: RadiantArbitrumVault(radiantVaultAddr).claimableRewards(
        receiver,
        userShares,
        portfolioShares
      )
    });
    return totalClaimableRewards;
  }
}
