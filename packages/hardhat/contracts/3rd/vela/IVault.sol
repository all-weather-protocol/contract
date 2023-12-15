// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

interface IVault {
  function stake(address _account, address _token, uint256 _amount) external;

  function unstake(address _tokenOut, uint256 _vlpAmount) external;
}
