// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./BaseEquilibriaVault.sol";

contract EquilibriaGDAIVault is BaseEquilibriaVault {
  IERC20 public immutable DAI;

  constructor(
    IERC20Metadata asset_,
    string memory name_,
    string memory symbol
  ) BaseEquilibriaVault(asset_, name_, symbol) {
    _initializePid(2);
    // // asset
    DAI = IERC20(0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1);
  }

  function totalUnstakedAssets() public view override returns (uint256) {
    // dai or gdai, depends on wether pendle can zap out dai or not
    return IERC20(asset()).balanceOf(address(this));
  }

  function _zapIn(
    uint256 amount,
    bytes calldata oneInchData,
    uint256 minLpOut,
    IPendleRouter.ApproxParams calldata guessPtReceivedFromSy,
    IPendleRouter.TokenInput calldata input
  ) internal override returns (uint256) {
    // swap weth to DAI with 1inch
    SafeERC20.safeApprove(WETH, oneInchAggregatorAddress, amount);
    (bool succ, bytes memory data) = address(oneInchAggregatorAddress).call(
      oneInchData
    );
    require(
      succ,
      "1inch failed to swap, please update your block_number when running hardhat test"
    );
    uint256 swappedDaiAmount = abi.decode(data, (uint256));
    // zap into pendle
    uint256 shares = super._zapIn(
      DAI,
      swappedDaiAmount,
      minLpOut,
      guessPtReceivedFromSy,
      input
    );
    // return the remaining DAI back to user
    // it's meant to have some dust left, since zapIn Data is pre-computed before 1inch swap
    // so cannot be 100% accurate
    SafeERC20.safeTransfer(DAI, msg.sender, DAI.balanceOf(address(this)));
    return shares;
  }
}
