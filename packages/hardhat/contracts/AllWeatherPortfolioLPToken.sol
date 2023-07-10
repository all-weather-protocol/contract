// SPDX-License-Identifier: MIT
// The code defines a Solidity contract called AllWeatherPortfolioLPToken that inherits from ERC20. It takes in several parameters on construction, including asset, radiantVaultAddr, and dpxVaultAddr. The contract has several functions that do the following:

// deposit: Takes in an amount and transfers tokens of asset from the user to the contract, then distributes the asset into two protocols (DPX and Radiant) based on a portfolioAllocation. The user receives an ERC20 token (AWVLP) in proportion to their deposit.
// redeem: Takes in a number of shares and an account, then redeems all DPX LP Tokens and sends them to the account. Only DPX LP tokens are redeemed. The proportion of redeemed tokens is distributed to the sender's ERC20 tokens (AWVLP).
// claimableRewards: Takes in an account, calculates the user's claimable rewards across both protocols and returns them.
// claim: Takes in an account and reward tokens, and claims all the available rewards across both protocols, sending them to the account.
// The code imports several open source libraries and uses various data structures like struct, bytes, and mapping. The SPDX-License-Identifier specifies the license for the code (MIT in this case).

pragma solidity ^0.8.4;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./RadiantArbitrumVault.sol";
import "./DpxArbitrumVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";

import "./radiant/IFeeDistribution.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./pendle/IPendleRouter.sol";
import "./vaults/EquilibriaGlpVault.sol";
import "./vaults/Equilibria/EquilibriaGDAIVault.sol";
import "./interfaces/AbstractVault.sol";

contract AllWeatherPortfolioLPToken is ERC20, Ownable {
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

  IERC20 public immutable asset;
  address public radiantVaultAddr;
  address payable public dpxVaultAddr;
  address public equilibriaVaultAddr;
  address public equilibriaGDAIVaultAddr;

  PortfolioAllocationOfSingleCategory[] public portfolioAllocation;
  AbstractVault[] public vaults = new AbstractVault[](4);

  constructor(
    address asset_,
    address radiantVaultAddr_,
    address payable dpxVaultAddr_,
    address equilibriaVaultAddr_,
    address equilibriaGDAIVaultAddr_
  ) ERC20("AllWeatherVaultLP", "AWVLP") {
    radiantVaultAddr = radiantVaultAddr_;
    dpxVaultAddr = dpxVaultAddr_;
    equilibriaVaultAddr = equilibriaVaultAddr_;
    equilibriaGDAIVaultAddr = equilibriaGDAIVaultAddr_;
    asset = ERC20(asset_);

    vaults[0] = DpxArbitrumVault(dpxVaultAddr);
    vaults[1] = RadiantArbitrumVault(radiantVaultAddr);
    vaults[2] = EquilibriaGlpVault(equilibriaVaultAddr);
    vaults[3] = EquilibriaGDAIVault(equilibriaGDAIVaultAddr);
  }

  function setVaultAllocations(
    PortfolioAllocationOfSingleCategory[] memory portfolioAllocation_
  ) public onlyOwner {
    uint256 length = portfolioAllocation_.length;

    // Clear existing storage array
    delete portfolioAllocation;

    // Assign each element individually
    for (uint256 i = 0; i < length; i++) {
      portfolioAllocation.push(portfolioAllocation_[i]);
    }
  }

  function deposit(
    uint256 amount,
    address receiver,
    bytes calldata oneInchDataDpx,
    uint256 minLpOut,
    IPendleRouter.ApproxParams calldata guessPtReceivedFromSy,
    IPendleRouter.TokenInput calldata input,
    bytes calldata oneInchDataGDAI
  ) public {
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
      uint256 zapInAmountForThisVault = Math.mulDiv(
        amount,
        portfolioAllocation[idx].percentage,
        100
      );
      if (protocolHash == keccak256(bytes("dpx"))) {
        SafeERC20.safeApprove(IERC20(asset), dpxVaultAddr, amount);
        require(
          DpxArbitrumVault(dpxVaultAddr).deposit(amount, oneInchDataDpx) > 0,
          "Buying Dpx LP token failed"
        );
      } else if (protocolHash == keccak256(bytes("radiant-arbitrum"))) {
        SafeERC20.safeApprove(IERC20(asset), radiantVaultAddr, amount);
        require(
          RadiantArbitrumVault(radiantVaultAddr).deposit(amount) > 0,
          "Buying Radiant LP token failed"
        );
      } else if (protocolHash == keccak256(bytes("equilibria-glp"))) {
        SafeERC20.safeApprove(
          IERC20(asset),
          equilibriaVaultAddr,
          zapInAmountForThisVault
        );
        require(
          EquilibriaGlpVault(equilibriaVaultAddr).deposit(
            zapInAmountForThisVault,
            minLpOut,
            guessPtReceivedFromSy,
            input
          ) > 0,
          "Zap Into Equilibria GLP failed"
        );
      } else if (protocolHash == keccak256(bytes("equilibria-gdai"))) {
        SafeERC20.safeApprove(
          IERC20(asset),
          equilibriaGDAIVaultAddr,
          zapInAmountForThisVault
        );
        require(
          EquilibriaGDAIVault(equilibriaGDAIVaultAddr).deposit(
            zapInAmountForThisVault,
            oneInchDataGDAI,
            minLpOut,
            guessPtReceivedFromSy,
            input
          ) > 0,
          "Zap Into Equilibria GDAI failed"
        );
      } else if (protocolHash == keccak256(bytes("radiant-bsc"))) {
        // need li.fi SDK
        // (bool succ, bytes memory data) = address(oneInchAggregatorAddress).call(
        //   oneInchData
        // );
      } else {
        revert("Protocol not supported");
      }
    }

    _mint(receiver, amount);
    emit Transfer(address(0), receiver, amount);
  }

  function redeem(
    uint256 shares,
    address receiver,
    IPendleRouter.TokenOutput calldata output
  ) public {
    for (uint256 i = 0; i < vaults.length; i++) {
      uint256 vaultShares = Math.mulDiv(
        vaults[i].balanceOf(address(this)),
        shares,
        totalSupply()
      );
      bytes32 bytesOfvaultName = keccak256(bytes(vaults[i].name()));
      if (vaultShares > 0) {
        if (
          bytesOfvaultName ==
          keccak256(bytes("AllWeatherLP-Equilibria-GDAI")) ||
          bytesOfvaultName == keccak256(bytes("AllWeatherLP-Equilibria-GLP"))
        ) {
          // equilibria needs `output` to be passed in
          vaults[i].redeem(vaultShares, output);
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

  function claim(
    address payable receiver,
    uint256[] memory equilibriaPids
  ) public {
    uint256 userShares = balanceOf(msg.sender);
    uint256 portfolioShares = totalSupply();
    if (userShares == 0 || portfolioShares == 0) {
      return;
    }
    for (uint256 i = 0; i < vaults.length; i++) {
      IFeeDistribution.RewardData[] memory rewardsOfThisVault;
      bytes32 bytesOfvaultName = keccak256(bytes(vaults[i].name()));
      if (
        bytesOfvaultName == keccak256(bytes("AllWeatherLP-Equilibria-GDAI")) ||
        bytesOfvaultName == keccak256(bytes("AllWeatherLP-Equilibria-GLP"))
      ) {
        // equilibria needs `pids` to be passed in
        rewardsOfThisVault = vaults[i].claim(equilibriaPids);
      } else {
        rewardsOfThisVault = vaults[i].claim();
      }
      if (
        bytesOfvaultName == keccak256(bytes("AllWeatherLP-SushSwap-DpxETH"))
      ) {
        _distributeERC20UserRewardProRata(
          receiver,
          userShares,
          portfolioShares,
          rewardsOfThisVault
        );
      } else if (
        bytesOfvaultName == keccak256(bytes("AllWeatherLP-RadiantArbitrum-DLP"))
      ) {
        _distributeRadiantUserRewardProRata(
          receiver,
          userShares,
          portfolioShares
        );
      } else if (
        bytesOfvaultName == keccak256(bytes("AllWeatherLP-Equilibria-GDAI")) ||
        bytesOfvaultName == keccak256(bytes("AllWeatherLP-Equilibria-GLP"))
      ) {
        // equilibria needs `output` to be passed in
        _distributeERC20UserRewardProRata(
          receiver,
          userShares,
          portfolioShares,
          rewardsOfThisVault
        );
      }
    }
  }

  function getClaimableRewards(
    address receiver
  ) public view returns (ClaimableRewardOfAProtocol[] memory) {
    uint256 userShares = balanceOf(receiver);
    uint256 portfolioShares = totalSupply();
    if (userShares == 0 || portfolioShares == 0) {
      return new ClaimableRewardOfAProtocol[](0);
    }

    ClaimableRewardOfAProtocol[]
      memory totalClaimableRewards = new ClaimableRewardOfAProtocol[](
        vaults.length
      );
    for (uint256 i = 0; i < vaults.length; i++) {
      bytes32 bytesOfvaultName = keccak256(bytes(vaults[i].name()));
      if (
        bytesOfvaultName == keccak256(bytes("AllWeatherLP-RadiantArbitrum-DLP"))
      ) {
        totalClaimableRewards[i] = ClaimableRewardOfAProtocol({
          protocol: vaults[i].name(),
          claimableRewards: _multiplyProRataRatioToClaimableRewards(
            vaults[i].getClaimableRewards(),
            userShares,
            portfolioShares
          )
        });
      } else {
        totalClaimableRewards[i] = ClaimableRewardOfAProtocol({
          protocol: vaults[i].name(),
          claimableRewards: vaults[i].getClaimableRewards()
        });
      }
    }
    return totalClaimableRewards;
  }

  function _multiplyProRataRatioToClaimableRewards(
    IFeeDistribution.RewardData[] memory claimableRewards,
    uint256 userShares,
    uint256 portfolioShares
  ) internal pure returns (IFeeDistribution.RewardData[] memory) {
    for (uint i = 0; i < claimableRewards.length; i++) {
      claimableRewards[i].amount = Math.mulDiv(
        claimableRewards[i].amount,
        userShares,
        portfolioShares
      );
    }
    return claimableRewards;
  }

  function _distributeERC20UserRewardProRata(
    address receiver,
    uint256 userShares,
    uint256 portfolioShares,
    IFeeDistribution.RewardData[] memory erc20Rewards
  ) internal {
    for (uint i = 0; i < erc20Rewards.length; i++) {
      SafeERC20.safeTransfer(
        IERC20(erc20Rewards[i].token),
        receiver,
        erc20Rewards[i].amount
      );
    }
  }

  function _distributeRadiantUserRewardProRata(
    address payable receiver,
    uint256 userShares,
    uint256 portfolioShares
  ) internal {
    // rToken
    _distributeRtokenRewardProRata(receiver, userShares, portfolioShares);
    // weth
    _distributeEthRewardProRata(receiver, userShares, portfolioShares);
  }

  function _distributeRtokenRewardProRata(
    address payable receiver,
    uint256 userShares,
    uint256 portfolioShares
  ) internal {
    address[] memory radiantRewardNativeTokenAddresses = RadiantArbitrumVault(
      radiantVaultAddr
    ).getRadiantRewardNativeTokenAddresses();
    // rToken
    for (uint i = 0; i < radiantRewardNativeTokenAddresses.length; i++) {
      uint256 userReward = _checkUserRewardPerTokenPaid(
        IERC20(radiantRewardNativeTokenAddresses[i]).balanceOf(address(this)),
        userShares,
        portfolioShares
      );
      SafeERC20.safeTransfer(
        IERC20(radiantRewardNativeTokenAddresses[i]),
        receiver,
        userReward
      );
    }
  }

  function _distributeEthRewardProRata(
    address payable receiver,
    uint256 userShares,
    uint256 portfolioShares
  ) internal {
    uint256 amountOfEthToTransfer = _checkUserRewardPerTokenPaid(
      address(this).balance,
      userShares,
      portfolioShares
    );
    require(
      address(this).balance >= amountOfEthToTransfer,
      "Insufficient eth balance in contract"
    );
    receiver.transfer(amountOfEthToTransfer);
  }

  function _checkUserRewardPerTokenPaid(
    uint256 tokenOfPortfolio,
    uint256 userShares,
    uint256 portfolioShares
  ) internal view returns (uint256) {
    // TODO: current implementation is not accurate
    // need to implement the user reward per token paid like what convex and equilibria do
    return Math.mulDiv(tokenOfPortfolio, userShares, portfolioShares);
  }

  receive() external payable {}
}
