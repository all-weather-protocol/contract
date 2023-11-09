// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./3rd/radiant/IFeeDistribution.sol";
import "./3rd/pendle/IPendleRouter.sol";
import "./interfaces/AbstractVaultV2.sol";
import {DepositData} from "./DepositData.sol";
import "./vaults/apolloX/ApolloXRedeemData.sol";

abstract contract BasePortfolioV2 is ERC20, Ownable, ReentrancyGuard, Pausable {
  using SafeERC20 for IERC20;

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

  struct RedeemData {
    uint256 amount;
    address receiver;
    ApolloXRedeemData apolloXRedeemData;
  }
  struct ClaimData {
    address receiver;
    VaultClaimData apolloXClaimData;
  }

  struct VaultClaimData {
    address tokenOut;
    bytes aggregatorData;
  }

  uint256 public balanceOfProtocolFee;

  mapping(string => uint256) public portfolioAllocation;
  AbstractVaultV2[] internal vaults;
  mapping(address => mapping(string => mapping(address => uint256)))
    public userRewardsOfInvestedProtocols;

  // userRewardPerTokenPaidPointerMapping is like a pointer, it points out how much rewards we have planned to distribute to this user. Doesn't mean we have distributed it to the user. `userRewardsOfInvestedProtocols` is the one which record how much the user can claim. userRewardPerTokenPaidPointerMapping is a pointer for the contract to know whether the contract has distribute the rewards to the user's userRewardsOfInvestedProtocols at this round or not.
  mapping(address => mapping(string => mapping(address => uint256)))
    public userRewardPerTokenPaidPointerMapping;

  // similar to userRewardPerTokenPaidPointerMapping, but this one is for the portfolio contract to know how much claimable rewards we can distribute to the user via `updateRewards()` at this round, by thinking of `claimable - pointersOfThisPortfolioForRecordingDistributedRewards` as allocatable rewards at this round. Will be reseted when someone trigger the `claim()` of that vault. If we don't have this pointer, we'll recalculate the reward amount of claimableRewards() every time someone triggers deposit(), redeem(), and claim(), resulting in an overestimate of rewardPerShareZappedIn.
  mapping(address => mapping(address => uint256))
    public pointersOfThisPortfolioForRecordingDistributedRewards;

  mapping(string => mapping(address => uint256)) public rewardPerShareZappedIn;
  uint256 public constant UNIT_OF_SHARES = 1e10;
  address public oneInchAggregatorAddress;

  constructor(
    string memory name_,
    string memory symbol_
  ) ERC20(name_, symbol_) Ownable(msg.sender) {}

  function updateOneInchAggregatorAddress(
    address oneInchAggregatorAddress_
  ) external onlyOwner {
    require(oneInchAggregatorAddress_ != address(0), "Address cannot be zero");
    oneInchAggregatorAddress = oneInchAggregatorAddress_;
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
            pointersOfThisPortfolioForRecordingDistributedRewards[
              address(vaults[vaultIdx])
            ][addressOfReward];
        pointersOfThisPortfolioForRecordingDistributedRewards[
          address(vaults[vaultIdx])
        ][addressOfReward] = totalClaimableRewards[vaultIdx]
          .claimableRewards[rewardIdxOfThisVault]
          .amount;
        _updateUserSpecificReward(
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
    (
      address addressOfTokenForDiversification,
      uint256 amountOfTokenForDiversification
    ) = _getToken(depositData);
    uint256 portfolioSharesToBeMinted = _diversify(
      depositData,
      addressOfTokenForDiversification,
      amountOfTokenForDiversification
    );
    _mintShares(depositData, portfolioSharesToBeMinted);
  }

  function redeem(
    RedeemData calldata redeemData
  ) public updateRewards whenNotPaused nonReentrant {
    require(redeemData.amount <= totalSupply(), "Shares exceed total supply");
    for (uint256 i = 0; i < vaults.length; i++) {
      uint256 vaultShares = Math.mulDiv(
        vaults[i].balanceOf(address(this)),
        redeemData.amount,
        totalSupply()
      );
      bytes32 bytesOfvaultName = keccak256(bytes(vaults[i].name()));
      if (vaultShares > 0) {
        if (bytesOfvaultName == keccak256(bytes("ApolloX-ALP"))) {
          uint256 redeemAmount = vaults[i].redeem(
            vaultShares,
            redeemData.apolloXRedeemData
          );
          if (redeemData.apolloXRedeemData.aggregatorData.length > 0) {
            uint256 swappedAmount = _swap(
              IERC20(redeemData.apolloXRedeemData.alpTokenOut),
              redeemData.apolloXRedeemData.aggregatorData
            );
            SafeERC20.safeTransfer(
              IERC20(redeemData.apolloXRedeemData.tokenOut),
              redeemData.receiver,
              swappedAmount
            );
          } else {
            SafeERC20.safeTransfer(
              IERC20(redeemData.apolloXRedeemData.alpTokenOut),
              redeemData.receiver,
              redeemAmount
            );
          }
        }
      }
    }
    _burn(msg.sender, redeemData.amount);
  }

  function claim(
    ClaimData calldata claimData,
    bool useDump
  ) external whenNotPaused nonReentrant {
    // this function is for `nonReentrant`
    _claim(claimData, useDump);
  }

  function _claim(
    ClaimData calldata claimData,
    bool useDump
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
      bytes32 bytesOfvaultName = keccak256(bytes(protocolNameOfThisVault));
      if (bytesOfvaultName == keccak256(bytes("ApolloX-ALP"))) {
        // slither-disable-next-line calls-loop
        _claimAllTheRewardsInThisVault(
          vaultIdx,
          totalClaimableRewards,
          protocolNameOfThisVault,
          claimData.apolloXClaimData,
          useDump,
          claimData.receiver
        );
      } else {
        revert(
          string(abi.encodePacked("Unknow Vault:", protocolNameOfThisVault))
        );
      }
    }
  }

  function _claimAllTheRewardsInThisVault(
    uint256 vaultIdx,
    ClaimableRewardOfAProtocol[] memory totalClaimableRewards,
    string memory protocolNameOfThisVault,
    VaultClaimData calldata valutClaimData,
    bool useDump,
    address receiver
  ) internal {
    try vaults[vaultIdx].claim() {
      for (
        uint256 rewardIdxOfThisVault = 0;
        rewardIdxOfThisVault <
        totalClaimableRewards[vaultIdx].claimableRewards.length;
        rewardIdxOfThisVault++
      ) {
        address addressOfReward = totalClaimableRewards[vaultIdx]
          .claimableRewards[rewardIdxOfThisVault]
          .token;
        _transferReward(
          addressOfReward,
          valutClaimData,
          protocolNameOfThisVault,
          useDump,
          receiver
        );
        _resetUserRewardsOfInvestedProtocols(
          address(vaults[vaultIdx]),
          protocolNameOfThisVault,
          addressOfReward
        );
      }
    } catch Error(string memory _errorMessage) {
      emit ClaimError(_errorMessage);
    }
  }

  function _transferReward(
    address addressOfReward,
    VaultClaimData calldata valutClaimData,
    string memory protocolNameOfThisVault,
    bool useDump,
    address receiver
  ) internal {
    IERC20 rewardToken = IERC20(addressOfReward);
    if (useDump == false) {
      SafeERC20.safeTransfer(
        rewardToken,
        receiver,
        userRewardsOfInvestedProtocols[msg.sender][protocolNameOfThisVault][
          addressOfReward
        ]
      );
    } else {
      uint256 swappedAmount = _swap(rewardToken, valutClaimData.aggregatorData);
      SafeERC20.safeTransfer(
        IERC20(valutClaimData.tokenOut),
        receiver,
        swappedAmount
      );
    }
  }

  function _getToken(
    DepositData calldata depositData
  ) internal returns (address, uint256) {
    SafeERC20.safeTransferFrom(
      IERC20(depositData.tokenIn),
      msg.sender,
      address(this),
      depositData.amount
    );
    if (depositData.aggregatorData.length > 0) {
      return (
        depositData.tokenInAfterSwap,
        _swap(IERC20(depositData.tokenIn), depositData.aggregatorData)
      );
    }
    return (depositData.tokenIn, depositData.amount);
  }

  function _diversify(
    DepositData calldata depositData,
    address addressOfTokenForDiversification,
    uint256 amountOfTokenForDiversification
  ) internal returns (uint256) {
    uint256 portfolioSharesToBeMinted = 0;
    for (uint256 idx = 0; idx < vaults.length; idx++) {
      // slither-disable-next-line calls-loop
      string memory nameOfThisVault = vaults[idx].name();
      bytes32 bytesOfvaultName = keccak256(bytes(nameOfThisVault));
      uint256 zapInAmountForThisVault = Math.mulDiv(
        amountOfTokenForDiversification,
        portfolioAllocation[nameOfThisVault],
        100
      );
      // slither-disable-next-line incorrect-equality
      if (zapInAmountForThisVault == 0) {
        continue;
      }
      SafeERC20.forceApprove(
        IERC20(addressOfTokenForDiversification),
        address(vaults[idx]),
        zapInAmountForThisVault
      );

      // slither-disable-next-line calls-loop
      portfolioSharesToBeMinted = vaults[idx].deposit(
        zapInAmountForThisVault,
        depositData
        // depositData.tokenInAfterSwap,
        // depositData.apolloXDepositData
      );
      require(portfolioSharesToBeMinted > 0, "Buying ApolloX-ALP token failed");
    }
    return portfolioSharesToBeMinted;
  }

  function _mintShares(
    DepositData calldata depositData,
    uint256 portfolioSharesToBeMinted
  ) internal {
    (bool succ, uint256 shares) = Math.tryDiv(
      portfolioSharesToBeMinted,
      UNIT_OF_SHARES
    );
    require(succ, "Division failed");
    require(shares > 0, "Shares must > 0");
    _mint(depositData.receiver, shares);
  }

  function _swap(
    IERC20 rewardToken,
    bytes calldata aggregatorData
  ) public returns (uint256) {
    SafeERC20.forceApprove(
      rewardToken,
      oneInchAggregatorAddress,
      rewardToken.balanceOf(address(this))
    );
    // slither-disable-next-line low-level-calls
    (bool succ, bytes memory data) = address(oneInchAggregatorAddress).call(
      aggregatorData
    );
    require(
      succ,
      "Aggregator failed to swap, please update your block_number when running hardhat test"
    );
    return abi.decode(data, (uint256));
  }

  function _resetUserRewardsOfInvestedProtocols(
    address vaultAddress,
    string memory protocolNameOfThisVault,
    address addressOfReward
  ) internal {
    pointersOfThisPortfolioForRecordingDistributedRewards[vaultAddress][
      addressOfReward
    ] = 0;
    userRewardsOfInvestedProtocols[msg.sender][protocolNameOfThisVault][
      addressOfReward
    ] = 0;
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

  function _updateUserSpecificReward(
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
    (bool succ, uint256 rewardPerShare) = Math.tryDiv(
      oneOfTheUnclaimedRewardsAmountBelongsToThisPortfolio,
      totalSupply()
    );
    require(succ, "Division failed");
    return rewardPerShare;
  }

  // solhint-disable-next-line no-empty-blocks
  receive() external payable {}
}
