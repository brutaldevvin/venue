// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Atomic delivery-versus-payment for one asset pair, with no custody.
///
/// The contract is never `from` or `to` on either leg (decision D1). Cleanverse confirmed
/// that a contract holding a CVA needs its own CVI registered through `registerApass`,
/// which lives in the Validator Compliance module - the one not configured on Monad.
/// Escrow would have forced a chain move to Base. Non-custodial sidesteps it, and is the
/// better design regardless: no custody risk, no escrow accounting, fewer lines.
///
/// Neither leg calls `canTransfer` explicitly. Both tokens are CVAs, so each one's
/// `_update` re-verifies its own counterparties - the check is free and cannot be skipped.
/// That is what makes the matcher untrusted: it can hide liquidity, but it cannot cause a
/// trade the chain would refuse.
contract Settlement is Ownable {
    using SafeERC20 for IERC20;

    error NotAgent();

    event Settled(
        bytes32 indexed matchId,
        address indexed seller,
        address indexed buyer,
        uint256 qty,
        uint256 notional
    );

    struct Match {
        bytes32 id;
        address seller;
        address buyer;
        uint256 qty; // units of `security`
        uint256 notional; // units of `cash`
    }

    IERC20 public immutable security;
    IERC20 public immutable cash;

    /// @notice The settlement agent, operating under an EIP-191 mandate verified off-chain.
    address public agent;

    constructor(address security_, address cash_, address agent_, address owner_) Ownable(owner_) {
        security = IERC20(security_);
        cash = IERC20(cash_);
        agent = agent_;
    }

    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    /// @notice Move both legs in one transaction. A revert on either reverts both - the
    ///         atomicity is the whole product, so this function stays small.
    ///
    /// @dev SafeERC20 rather than a bare call: `Listed` reverts on refusal, but the cash
    ///      leg may be a plain ERC-20 that returns false instead (aUSDC is live on Monad
    ///      but not registered under the policy). An unchecked return there would settle
    ///      one leg and silently skip the other, which is exactly the failure DvP exists
    ///      to prevent.
    function settle(Match calldata m) external onlyAgent {
        security.safeTransferFrom(m.seller, m.buyer, m.qty);
        cash.safeTransferFrom(m.buyer, m.seller, m.notional);
        emit Settled(m.id, m.seller, m.buyer, m.qty, m.notional);
    }
}
