// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Listed} from "../src/Listed.sol";
import {Settlement} from "../src/Settlement.sol";
import {MockPolicy} from "../src/MockPolicy.sol";
import {IATokenPolicy, IComplianceRule} from "../src/IATokenPolicy.sol";

contract SettlementTest is Test {
    MockPolicy policy;
    Listed security;
    Listed cash;
    Settlement settlement;

    address owner = address(this);
    address agent = address(0xA9E27);
    address seller = address(0x5E11E2);
    address buyer = address(0xB4E2);

    bytes2 constant GROUP_CD = 0x4344;

    function setUp() public {
        policy = new MockPolicy();

        security = new Listed("ReVault Reg S T-Bill", "RVS", address(policy), 99, owner);
        // The cash leg is a CVA stablecoin under the same policy, so DvP moves both at once.
        cash = new Listed("Cleanverse USD", "aUSDC", address(policy), type(uint256).max, owner);

        settlement = new Settlement(address(security), address(cash), agent, owner);

        _rule(address(security), 9);
        _rule(address(cash), 9);

        _credential(seller, 9);
        _credential(buyer, 9);

        security.mint(seller, 1_000);
        cash.mint(buyer, 1_000_000);

        vm.prank(seller);
        security.approve(address(settlement), type(uint256).max);
        vm.prank(buyer);
        cash.approve(address(settlement), type(uint256).max);
    }

    function _rule(address token, uint8 minSubTier) internal {
        policy.setRuleV2(
            token,
            IComplianceRule.RuleV2({
                allowedGroup: bytes2(0),
                allowedSubGroup: bytes2(0),
                minTier: 0,
                minSubTier: minSubTier,
                isBlackList: false,
                countryBitmap: 0
            })
        );
    }

    function _credential(address who, uint8 subTier) internal {
        policy.setCredential(who, bytes2(0), GROUP_CD, 20, subTier, 0);
    }

    function _match() internal pure returns (Settlement.Match memory) {
        return Settlement.Match({
            id: keccak256("match-1"),
            seller: address(0x5E11E2),
            buyer: address(0xB4E2),
            qty: 100,
            notional: 10_000
        });
    }

    function test_settle_movesBothLegsInOneTransaction() public {
        vm.prank(agent);
        settlement.settle(_match());

        assertEq(security.balanceOf(seller), 900);
        assertEq(security.balanceOf(buyer), 100);
        assertEq(cash.balanceOf(buyer), 990_000);
        assertEq(cash.balanceOf(seller), 10_000);
    }

    /// @dev D1: the contract is never `from` or `to` on either leg. If this ever fails, the
    ///      contract needs its own CVI registered through the Validator Compliance module -
    ///      which is not configured on Monad, and would force the demo onto Base.
    function test_settlementNeverHoldsEitherAsset() public {
        assertEq(security.balanceOf(address(settlement)), 0);
        assertEq(cash.balanceOf(address(settlement)), 0);

        vm.prank(agent);
        settlement.settle(_match());

        assertEq(security.balanceOf(address(settlement)), 0);
        assertEq(cash.balanceOf(address(settlement)), 0);
    }

    function test_revertOnSecurityLeg_revertsBoth() public {
        // The buyer's credential lapses between match and settlement.
        policy.clearCredential(buyer);

        vm.prank(agent);
        vm.expectRevert(IATokenPolicy.TransferNotAllowed.selector);
        settlement.settle(_match());

        assertEq(security.balanceOf(seller), 1_000);
        assertEq(cash.balanceOf(buyer), 1_000_000);
    }

    function test_revertOnCashLeg_revertsBoth() public {
        // The security leg would pass, but the cash leg's rule set will not.
        _rule(address(cash), 99);

        vm.prank(agent);
        vm.expectRevert(IATokenPolicy.TransferNotAllowed.selector);
        settlement.settle(_match());

        // Neither leg moved - the atomicity is the whole product.
        assertEq(security.balanceOf(seller), 1_000);
        assertEq(security.balanceOf(buyer), 0);
        assertEq(cash.balanceOf(buyer), 1_000_000);
        assertEq(cash.balanceOf(seller), 0);
    }

    /// @dev The holder cap binds inside settlement too, not just in the matcher (D2) - so a
    ///      matcher that ignored the cap still could not push a bad trade through.
    function test_capBreachAtSettlement_revertsBoth() public {
        Listed capped = new Listed("Capped", "CAP", address(policy), 1, owner);
        _rule(address(capped), 9);
        capped.mint(seller, 1_000);
        vm.prank(seller);
        capped.approve(address(settlement), type(uint256).max);

        Settlement s2 = new Settlement(address(capped), address(cash), agent, owner);
        vm.prank(seller);
        capped.approve(address(s2), type(uint256).max);

        assertEq(capped.holderCount(), 1);

        vm.prank(agent);
        vm.expectRevert(Listed.HolderCapExceeded.selector);
        s2.settle(_match());

        assertEq(cash.balanceOf(buyer), 1_000_000);
    }

    function test_onlyAgentMaySettle() public {
        vm.prank(buyer);
        vm.expectRevert(Settlement.NotAgent.selector);
        settlement.settle(_match());
    }

    function test_strictPolicy_stillAtomic() public {
        policy.setStrictMode(true);
        policy.clearCredential(buyer);

        vm.prank(agent);
        vm.expectRevert(IATokenPolicy.TransferNotAllowed.selector);
        settlement.settle(_match());

        assertEq(security.balanceOf(seller), 1_000);
        assertEq(cash.balanceOf(buyer), 1_000_000);
    }
}
