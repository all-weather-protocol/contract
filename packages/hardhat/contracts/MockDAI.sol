// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockDAI is ERC20 {
  constructor() ERC20("WooCoin", "WC") {
    _mint(msg.sender, 10e5 * 10e18);
  }
}
