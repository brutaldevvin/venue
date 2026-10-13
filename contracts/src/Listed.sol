// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IATokenPolicy} from "./IATokenPolicy.sol";

/// @notice A CVA security: an ERC-20 whose every transfer is gated by the CCP policy, plus
///         a holder cap the policy cannot express.
///
/// The cap lives here rather than in the matcher (decision D2). `RuleV2` has no cap field,
/// so `canTransfer` will never refuse for a cap breach; enforce it only off-chain and it is
/// not enforced at all, because anyone can transfer outside Venue and blow through it.
contract Listed is ERC20, Ownable {
    error HolderCapExceeded();

    /// @notice The compliance policy. Constructor argument, never a constant, so the same
    ///         bytecode runs against MockPolicy and against the deployed CCP policy (D3).
    IATokenPolicy public immutable policy;

    /// @notice Maximum distinct holders. The 99-holder cap the demo turns on.
    uint256 public immutable maxHolders;

    /// @notice Distinct addresses holding a non-zero balance.
    uint256 public holderCount;

    constructor(
        string memory name_,
        string memory symbol_,
        address policy_,
        uint256 maxHolders_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        policy = IATokenPolicy(policy_);
        maxHolders = maxHolders_;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Redemption. The transfer agent retires units; the holder count follows.
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        // D4: the deployed policy reverts with bare `0x` rather than returning false, so a
        // plain call would surface as an unrelated failure. Both outcomes mean the same
        // thing here, and both must produce our named error.
        try policy.canTransfer(address(this), from, to, amount) returns (bool ok) {
            if (!ok) revert IATokenPolicy.TransferNotAllowed();
        } catch {
            revert IATokenPolicy.TransferNotAllowed();
        }

        // Counted before the balance moves: `to` is a new holder only if it holds nothing
        // yet. A zero-amount transfer creates no holder.
        bool newHolder = to != address(0) && balanceOf(to) == 0 && amount > 0;
        if (newHolder && holderCount >= maxHolders) revert HolderCapExceeded();

        super._update(from, to, amount);

        if (newHolder) holderCount++;
        // Counted after: a sender that has gone to zero is no longer a holder. Burns land
        // here too, since `to` is zero and only the `from` side changes.
        if (from != address(0) && balanceOf(from) == 0) holderCount--;
    }
}
