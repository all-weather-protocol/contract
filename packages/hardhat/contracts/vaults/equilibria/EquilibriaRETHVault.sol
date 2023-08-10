// SPDX-License-Identifier: MIT

pragma solidity ^0.8.21;
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./BaseEquilibriaVault.sol";

contract EquilibriaRETHVault is BaseEquilibriaVault {
  IERC20 public immutable RETH =
    IERC20(0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8);

  constructor(
    IERC20Metadata asset_,
    string memory name_,
    string memory symbol
  ) BaseEquilibriaVault(asset_, name_, symbol) {
    pid = 8;
  }

  function totalUnstakedAssets() public view override returns (uint256) {
    return IERC20(asset()).balanceOf(address(this));
  }

  function _zapIn(
    uint256 amount,
    bytes calldata oneInchData,
    uint256 minLpOut,
    IPendleRouter.ApproxParams calldata guessPtReceivedFromSy,
    IPendleRouter.TokenInput calldata input
  ) internal override returns (uint256) {
    // swap weth to RETH with 1inch
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
      RETH,
      swappedDaiAmount,
      minLpOut,
      guessPtReceivedFromSy,
      input
    );
    // return the remaining RETH back to user
    // it's meant to have some dust left, since zapIn Data is pre-computed before 1inch swap
    // so cannot be 100% accurate
    SafeERC20.safeTransfer(RETH, msg.sender, RETH.balanceOf(address(this)));
    return shares;
  }
}
