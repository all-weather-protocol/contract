// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./3rd/radiant/IFeeDistribution.sol";
import "./3rd/pendle/IPendleRouter.sol";
import "./interfaces/AbstractVaultV2.sol";
import "./vaults/apolloX/ApolloXDepositData.sol";

abstract contract BasePortfolioV2 is ERC20, Ownable, ReentrancyGuard, Pausable {
  using SafeERC20 for IERC20;
  using SafeMath for uint256;
  event ClaimError(string errorMessage);

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
    ApolloXDepositData apolloXDepositData;
  }

  IERC20 public immutable asset;
  uint256 public balanceOfProtocolFee;

  mapping(string => uint256) public portfolioAllocation;
  AbstractVaultV2[] internal vaults;
  mapping(address => mapping(string => mapping(address => uint256)))
    public userRewardsOfInvestedProtocols;

  // userRewardPerTokenPaidPointerMapping is like a pointer, it points out how much rewards we have planned to distribute to this user. Doesn't mean we have distributed it to the user. `userRewardsOfInvestedProtocols` is the one which record how much the user can claim. userRewardPerTokenPaidPointerMapping is a pointer for the contract to know whether the contract has distribute the rewards to the user's userRewardsOfInvestedProtocols at this round or not.
  mapping(address => mapping(string => mapping(address => uint256)))
    public userRewardPerTokenPaidPointerMapping;

  // similar to userRewardPerTokenPaidPointerMapping, but this one is for the contract to know how much claimable rewards we can distribute to the user at this round, by thinking of `claimable - pointersOfEachClaimableReward` as allocatable rewards at this round. Will be reseted when someone trigger the `claim()` of that vault
  mapping(address => mapping(address => uint256))
    public pointersOfEachClaimableReward;

  mapping(string => mapping(address => uint256)) public rewardPerShareZappedIn;
  uint256 public constant UNIT_OF_SHARES = 10e15;

  constructor(
    address asset_,
    string memory name_,
    string memory symbol_
  ) ERC20(name_, symbol_) {
    asset = ERC20(asset_);
  }

  function getVaults() external view returns (AbstractVaultV2[] memory) {
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
        address addressOfReward = totalClaimableRewards[vaultIdx]
          .claimableRewards[rewardIdxOfThisVault]
          .token;
        uint256 oneOfTheUnclaimedRewardsAmountBelongsToThisPortfolio = totalClaimableRewards[
            vaultIdx
          ].claimableRewards[rewardIdxOfThisVault].amount -
            pointersOfEachClaimableReward[address(vaults[vaultIdx])][
              addressOfReward
            ];
        pointersOfEachClaimableReward[address(vaults[vaultIdx])][
          addressOfReward
        ] = totalClaimableRewards[vaultIdx]
          .claimableRewards[rewardIdxOfThisVault]
          .amount;
        _updateSpecificReward(
          totalClaimableRewards[vaultIdx].protocol,
          addressOfReward,
          oneOfTheUnclaimedRewardsAmountBelongsToThisPortfolio
        );
      }
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
      // slither-disable-next-line calls-loop
      string memory nameOfThisVault = vaults[i].name();
      nameOfVaults[i] = nameOfThisVault;
      percentages[i] = portfolioAllocation[nameOfThisVault];
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

  function deposit(
    DepositData calldata depositData
  ) public updateRewards whenNotPaused nonReentrant {
    require(depositData.amount > 0, "amount must > 0");

    // Transfer tokens from the user to the contract
    SafeERC20.safeTransferFrom(
      IERC20(asset),
      msg.sender,
      address(this),
      depositData.amount
    );
    uint256 portfolioSharesToBeMinted = 0;
    for (uint256 idx = 0; idx < vaults.length; idx++) {
      // slither-disable-next-line calls-loop
      string memory nameOfThisVault = vaults[idx].name();
      bytes32 bytesOfvaultName = keccak256(bytes(nameOfThisVault));
      uint256 zapInAmountForThisVault = Math.mulDiv(
        depositData.amount,
        portfolioAllocation[nameOfThisVault],
        100
      );
      // slither-disable-next-line incorrect-equality
      if (zapInAmountForThisVault == 0) {
        continue;
      }
      uint256 currentAllowance = IERC20(asset).allowance(
        address(this),
        address(vaults[idx])
      );
      if (currentAllowance > 0) {
        SafeERC20.safeApprove(IERC20(asset), address(vaults[idx]), 0);
      }
      SafeERC20.safeApprove(
        IERC20(asset),
        address(vaults[idx]),
        zapInAmountForThisVault
      );

      if (bytesOfvaultName == keccak256(bytes("ApolloX-ALP"))) {
        // slither-disable-next-line calls-loop
        portfolioSharesToBeMinted = vaults[idx].deposit(
          zapInAmountForThisVault,
          depositData.apolloXDepositData
        );
        require(
          portfolioSharesToBeMinted > 0,
          "Buying ApolloX-ALP token failed"
        );
      } else {
        revert(string(abi.encodePacked("Unknow Vault:", nameOfThisVault)));
      }
    }

    require(portfolioSharesToBeMinted > 0, "Shares must > 0");
    _mint(depositData.receiver, portfolioSharesToBeMinted);
  }

  function redeem(
    uint256 shares,
    address payable receiver
  ) public updateRewards whenNotPaused nonReentrant {
    require(shares <= totalSupply(), "Shares exceed total supply");
    for (uint256 i = 0; i < vaults.length; i++) {
      uint256 vaultShares = Math.mulDiv(
        vaults[i].balanceOf(address(this)),
        shares,
        totalSupply()
      );
      bytes32 bytesOfvaultName = keccak256(bytes(vaults[i].name()));
      if (vaultShares > 0) {
        vaults[i].redeem(vaultShares);
        SafeERC20.safeTransfer(
          IERC20(vaults[i].asset()),
          receiver,
          vaultShares
        );
      }
    }
    _burn(msg.sender, shares);
  }

  function claim(address payable receiver) external whenNotPaused nonReentrant {
    _claim(receiver);
  }

  function _claim(
    address payable receiver
  ) private whenNotPaused updateRewards {
    ClaimableRewardOfAProtocol[]
      memory totalClaimableRewards = getClaimableRewards(payable(msg.sender));
    uint256 userShares = balanceOf(msg.sender);
    // slither-disable-next-line incorrect-equality
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
      try vaults[vaultIdx].claim() {
        for (
          uint256 rewardIdxOfThisVault = 0;
          rewardIdxOfThisVault <
          totalClaimableRewards[vaultIdx].claimableRewards.length;
          rewardIdxOfThisVault++
        ) {
          pointersOfEachClaimableReward[address(vaults[vaultIdx])][
            totalClaimableRewards[vaultIdx]
              .claimableRewards[rewardIdxOfThisVault]
              .token
          ] = 0;
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
      } catch Error(string memory _errorMessage) {
        emit ClaimError(_errorMessage);
        continue;
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
      // slither-disable-next-line calls-loop
      string memory protocolNameOfThisVault = vaults[vaultIdx].name();
      // slither-disable-next-line calls-loop
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

  function rescueFundsWithHexData(
    address payable destination,
    uint256 amount,
    bytes memory hexData
  ) external onlyOwner {
    require(destination != address(0), "Invalid destination address");
    require(address(this).balance >= amount, "Insufficient balance");
    // solhint-disable-next-line avoid-low-level-calls
    (bool success, ) = destination.call{value: amount}(hexData);
    require(success, "Fund transfer failed");
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
          userRewardPerTokenPaidPointerMapping[owner][protocolNameOfThisVault][
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
    address addressOfReward,
    uint256 oneOfTheUnclaimedRewardsAmountBelongsToThisPortfolio
  ) internal {
    if (msg.sender != address(0)) {
      rewardPerShareZappedIn[protocolNameOfThisVault][
        addressOfReward
      ] += _calculateRewardPerShareDuringThisPeriod(
        oneOfTheUnclaimedRewardsAmountBelongsToThisPortfolio
      );
      userRewardsOfInvestedProtocols[msg.sender][protocolNameOfThisVault][
        addressOfReward
      ] += _calcualteUserEarnedBeforeThisUpdateAction(
        protocolNameOfThisVault,
        addressOfReward
      );
      userRewardPerTokenPaidPointerMapping[msg.sender][protocolNameOfThisVault][
        addressOfReward
      ] = rewardPerShareZappedIn[protocolNameOfThisVault][addressOfReward];
    }
  }

  function _calcualteUserEarnedBeforeThisUpdateAction(
    string memory protocolNameOfThisVault,
    address addressOfReward
  ) internal view returns (uint256) {
    return
      (rewardPerShareZappedIn[protocolNameOfThisVault][addressOfReward] -
        userRewardPerTokenPaidPointerMapping[msg.sender][
          protocolNameOfThisVault
        ][addressOfReward]) * balanceOf(msg.sender);
  }

  function _calculateRewardPerShareDuringThisPeriod(
    uint256 oneOfTheUnclaimedRewardsAmountBelongsToThisPortfolio
  ) internal view returns (uint256) {
    // slither-disable-next-line incorrect-equality
    if (totalSupply() == 0) {
      return 0;
    }
    return
      SafeMath.div(
        oneOfTheUnclaimedRewardsAmountBelongsToThisPortfolio,
        totalSupply()
      );
  }

  // solhint-disable-next-line no-empty-blocks
  receive() external payable {}
}
