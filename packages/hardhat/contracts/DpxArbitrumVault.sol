// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "hardhat/console.sol";
import "./dpx/IMiniChefV2.sol";
import "./dpx/ICloneRewarderTime.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./sushiSwap/IUniswapV2Router01.sol";
import "./utils/IWETH.sol";

contract DpxArbitrumVault is ERC4626 {
    using SafeMath for uint;
    using SafeERC20 for ERC20;

    /**
     * @dev Attempted to deposit more assets than the max amount for `receiver`.
     */
    error ERC4626ExceededMaxDeposit(
        address receiver,
        uint256 assets,
        uint256 max
    );

    uint256 percentageMultiplier = 10000;
    ERC20 public immutable dpxToken =
        ERC20(0x6C2C06790b3E3E3c38e12Ee22F8183b37a13EE55);
    ERC20 public immutable sushiToken =
        ERC20(0xd4d42F0b6DEF4CE0383636770eF773390d85c61A);
    address public immutable oneInchAggregatorAddress =
        0x1111111254fb6c44bAC0beD2854e76F90643097d;
    address public immutable sushiSwapRouterAddress =
        0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;
    address public immutable sushiSwapDpxLpTokenAddress =
        0x0C1Cf6883efA1B496B01f654E247B9b419873054;

    ICloneRewarderTime public immutable dpxRewarder =
        ICloneRewarderTime(0xb873813F710093CBC17836297A6feFCfc6989faF);
    IMiniChefV2 public sushiSwapMiniChef;

    uint256 public pid; // sushiSwap pid

    constructor(
        IERC20Metadata asset_,
        address sushiSwapMiniChefV2_,
        uint256 pid_
    ) ERC4626(asset_) ERC20("DpxVault", "DPXV") {
        pid = pid_;
        sushiSwapMiniChef = IMiniChefV2(sushiSwapMiniChefV2_);
    }

    function deposit(
        uint256 amount,
        address receiver,
        bytes calldata oneInchData
    ) public returns (uint256) {
        uint256 maxAssets = maxDeposit(receiver);
        if (amount > maxAssets) {
            revert ERC4626ExceededMaxDeposit(receiver, amount, maxAssets);
        }

        SafeERC20.safeTransferFrom(
            IERC20(asset()),
            msg.sender,
            address(this),
            amount
        );
        uint256 shares = _zapIn(amount, oneInchData);
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, amount, shares);
        return shares;
    }

    function redeemAll(
        uint256 shares,
        address receiver
    ) public returns (uint256) {
        // shares#1 stands for sushiSwap shares
        // shares#2 stands for erc4626 shares
        sushiSwapMiniChef.withdrawAndHarvest(pid, shares, address(this));
        uint256 shares = super.redeem(shares, receiver, msg.sender);
        return shares;
    }

    function claim(address receiver) public {
        sushiSwapMiniChef.harvest(pid, address(this));
        (uint256 sushiRewards, uint256 dpxRewards) = claimableRewards(
            address(this)
        );
        uint256 percentageWithMultiplier = balanceOf(receiver)
            .mul(percentageMultiplier)
            .div(totalSupply());

        uint256 sushiRewardsProRata = Math.mulDiv(
            sushiRewards,
            balanceOf(msg.sender),
            totalSupply()
        );
        uint256 dpxRewardsProRata = Math.mulDiv(
            dpxRewards,
            balanceOf(msg.sender),
            totalSupply()
        );
        SafeERC20.safeTransfer(sushiToken, receiver, sushiRewardsProRata);
        SafeERC20.safeTransfer(dpxToken, receiver, dpxRewardsProRata);
    }

    function claimableRewards(
        address receiver
    ) public view returns (uint256, uint256) {
        return (
            sushiSwapMiniChef.pendingSushi(pid, receiver),
            dpxRewarder.pendingToken(pid, receiver)
        );
    }

    function _zapIn(
        uint256 amount,
        bytes calldata oneInchData
    ) internal returns (uint256) {
        SafeERC20.safeApprove(
            IERC20(asset()),
            oneInchAggregatorAddress,
            Math.mulDiv(amount, 1, 2)
        );
        (bool succ, bytes memory data) = address(oneInchAggregatorAddress).call(
            oneInchData
        );
        require(succ, "1inch failed to swap");
        //  (uint256 dpxReturnedAmount, uint256 gasLeft) = abi.decode(data, (uint256, uint256));
        uint256 dpxReturnedAmount = dpxToken.balanceOf(address(this));
        SafeERC20.safeApprove(
            dpxToken,
            sushiSwapRouterAddress,
            dpxReturnedAmount
        );
        IWETH(asset()).withdraw(Math.mulDiv(amount, 1, 2));
        // deadline = current time + 5 minutes;
        uint256 deadline = block.timestamp + 300;
        // // TODO(david): should return those token left after `addLiquidityETH` back to user
        (uint amountToken, uint amountETH, uint liquidity) = IUniswapV2Router01(
            sushiSwapRouterAddress
        ).addLiquidityETH{value: address(this).balance}(
            address(dpxToken),
            dpxReturnedAmount,
            Math.mulDiv(dpxReturnedAmount, 95, 100),
            Math.mulDiv(address(this).balance, 95, 100),
            address(this),
            deadline
        );
        IERC20(sushiSwapDpxLpTokenAddress).approve(
            address(sushiSwapMiniChef),
            liquidity
        );
        sushiSwapMiniChef.deposit(pid, liquidity, address(this));
        return liquidity;
    }

    // To receive ETH from the WETH's withdraw function (it won't work without it)
    receive() external payable {}
}
