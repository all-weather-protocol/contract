// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface ITokenFarm {
  function depositVlp(uint256 _amount) external;

  function withdrawVlp(uint256 _amount) external;

  function harvestMany(
    bool _vela,
    bool _esvela,
    bool _vlp,
    bool _vesting
  ) external;

  function pendingTokens(
    bool _isVelaPool,
    address _user
  )
    external
    view
    returns (
      address[] memory,
      string[] memory,
      uint256[] memory,
      uint256[] memory
    );

  function getStakedVLP(
    address _account
  ) external view returns (uint256, uint256);
}
