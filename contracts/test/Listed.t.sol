// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Listed} from "../src/Listed.sol";
import {MockPolicy} from "../src/MockPolicy.sol";
import {IATokenPolicy, IComplianceRule} from "../src/IATokenPolicy.sol";

contract ListedTest is Test {
    MockPolicy policy;
    Listed listed;

    address owner = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA401);

    bytes2 constant GROUP_CD = 0x4344;

    function setUp() public {
        policy = new MockPolicy();
        listed = new Listed("ReVault Reg S T-Bill", "RVS", address(policy), 3, owner);

        // The asset's rule set: sub-tier 9 or better, which is what the demo wallets carry.
        policy.setRuleV2(
            address(listed),
            IComplianceRule.RuleV2({
                allowedGroup: bytes2(0),
                allowedSubGroup: bytes2(0),
                minTier: 0,
                minSubTier: 9,
                poolCountryBitmap: 0,
                isBlackList: false
            })
        );

        _credential(alice, 20, 9);
        _credential(bob, 20, 9);
        _credential(carol, 20, 9);
    }

    function _credential(address who, uint8 tier, uint8 subTier) internal {
        policy.setCredential(who, bytes2(0), GROUP_CD, tier, subTier, 0);
    }

    // ---- holderCount ---------------------------------------------------------

    function test_holderCount_incrementsOnMint() public {
        assertEq(listed.holderCount(), 0);
        listed.mint(alice, 100);
        assertEq(listed.holderCount(), 1);
        // Minting again to the same holder must not double-count.
        listed.mint(alice, 50);
        assertEq(listed.holderCount(), 1);
    }

    function test_holderCount_unchangedOnFullTransfer() public {
        listed.mint(alice, 100);
        vm.prank(alice);
        listed.transfer(bob, 100);
        // One holder left, one gained.
        assertEq(listed.holderCount(), 1);
        assertEq(listed.balanceOf(alice), 0);
        assertEq(listed.balanceOf(bob), 100);
    }

    function test_holderCount_incrementsOnPartialTransfer() public {
        listed.mint(alice, 100);
        vm.prank(alice);
        listed.transfer(bob, 40);
        assertEq(listed.holderCount(), 2);
    }

    function test_holderCount_decrementsOnBurnToZero() public {
        listed.mint(alice, 100);
        listed.mint(bob, 100);
        assertEq(listed.holderCount(), 2);

        listed.burn(alice, 100);
        assertEq(listed.holderCount(), 1);

        // A partial burn leaves the holder in place.
        listed.burn(bob, 40);
        assertEq(listed.holderCount(), 1);
    }

    // ---- the holder cap ------------------------------------------------------

    function test_capBreach_revertsWithNamedError() public {
        listed.mint(alice, 100);
        listed.mint(bob, 100);
        listed.mint(carol, 100);
        assertEq(listed.holderCount(), 3); // maxHolders

        address dave = address(0xDA5E);
        _credential(dave, 20, 9);

        vm.expectRevert(Listed.HolderCapExceeded.selector);
        listed.mint(dave, 1);
    }

    function test_capFull_existingHolderStillReceives() public {
        listed.mint(alice, 100);
        listed.mint(bob, 100);
        listed.mint(carol, 100);

        // The signature case, on-chain: with the cap full, a transfer to someone who
        // already holds is fine; one to a newcomer is not.
        vm.prank(alice);
        listed.transfer(bob, 10);
        assertEq(listed.balanceOf(bob), 110);
        assertEq(listed.holderCount(), 3);
    }

    function test_capFreesWhenAHolderExits() public {
        listed.mint(alice, 100);
        listed.mint(bob, 100);
        listed.mint(carol, 100);

        address dave = address(0xDA5E);
        _credential(dave, 20, 9);

        listed.burn(carol, 100);
        assertEq(listed.holderCount(), 2);

        listed.mint(dave, 1);
        assertEq(listed.holderCount(), 3);
    }

    // ---- compliance ----------------------------------------------------------

    function test_transferToIneligibleReverts() public {
        listed.mint(alice, 100);
        address mallory = address(0x1A11);
        _credential(mallory, 20, 8); // one sub-tier short

        vm.prank(alice);
        vm.expectRevert(IATokenPolicy.TransferNotAllowed.selector);
        listed.transfer(mallory, 1);
    }

    function test_transferToUncredentialedReverts() public {
        listed.mint(alice, 100);
        vm.prank(alice);
        vm.expectRevert(IATokenPolicy.TransferNotAllowed.selector);
        listed.transfer(address(0xDEAD), 1);
    }

    /// @dev The behaviour that matters most: the deployed policy refuses by reverting with
    ///      bare `0x`, not by returning false (D4). The try/catch must turn both into the
    ///      same named error, or a real refusal surfaces as an unrelated failure.
    function test_strictPolicyRevert_isCaughtAndRenamed() public {
        policy.setStrictMode(true);
        listed.mint(alice, 100);

        vm.prank(alice);
        vm.expectRevert(IATokenPolicy.TransferNotAllowed.selector);
        listed.transfer(address(0xDEAD), 1);
    }

    function test_strictMode_allowsEligibleTransfer() public {
        policy.setStrictMode(true);
        listed.mint(alice, 100);
        vm.prank(alice);
        listed.transfer(bob, 10);
        assertEq(listed.balanceOf(bob), 10);
    }

    // ---- country rules, both directions --------------------------------------

    uint256 constant US = 1 << 3;
    uint256 constant DE = 1 << 7;

    function _countryRule(uint256 bitmap, bool blacklist) internal {
        policy.setRuleV2(
            address(listed),
            IComplianceRule.RuleV2({
                allowedGroup: bytes2(0),
                allowedSubGroup: bytes2(0),
                minTier: 0,
                minSubTier: 0,
                poolCountryBitmap: bitmap,
                isBlackList: blacklist
            })
        );
    }

    /// @dev Whitelist: only the named countries may hold.
    function test_countryWhitelist_admitsOnlyListed() public {
        _countryRule(US, false);
        policy.setCredential(alice, bytes2(0), GROUP_CD, 20, 9, US);
        policy.setCredential(bob, bytes2(0), GROUP_CD, 20, 9, DE);

        assertTrue(policy.canTransfer(address(listed), address(0), alice, 1));
        assertFalse(policy.canTransfer(address(listed), address(0), bob, 1));
    }

    /// @dev Blacklist: the named countries are the ones refused. Getting this backwards
    ///      would admit exactly the holders the rule exists to exclude, so it is asserted
    ///      independently rather than inferred from the whitelist case.
    function test_countryBlacklist_refusesOnlyListed() public {
        _countryRule(US, true);
        policy.setCredential(alice, bytes2(0), GROUP_CD, 20, 9, US);
        policy.setCredential(bob, bytes2(0), GROUP_CD, 20, 9, DE);

        assertFalse(policy.canTransfer(address(listed), address(0), alice, 1));
        assertTrue(policy.canTransfer(address(listed), address(0), bob, 1));
    }

    /// @dev An empty country set is no constraint, whichever way the flag points.
    function test_emptyCountrySet_isUnrestricted() public {
        _countryRule(0, true);
        policy.setCredential(alice, bytes2(0), GROUP_CD, 20, 9, 0);
        assertTrue(policy.canTransfer(address(listed), address(0), alice, 1));
    }

    /// @dev Rules are OR across the array, so a listing can carry several cohorts. This is
    ///      also the shape that a five-field ABI decode corrupts: with one rule the missing
    ///      sixth field is harmless, with two the second rule misaligns entirely.
    function test_multipleRules_areOredAndDecodeCleanly() public {
        policy.setRuleV2(
            address(listed),
            IComplianceRule.RuleV2({
                allowedGroup: bytes2(0),
                allowedSubGroup: bytes2(0),
                minTier: 0,
                minSubTier: 70,
                poolCountryBitmap: 0,
                isBlackList: false
            })
        );
        policy.addRuleV2(
            address(listed),
            IComplianceRule.RuleV2({
                allowedGroup: bytes2(0),
                allowedSubGroup: 0x4344,
                minTier: 0,
                minSubTier: 9,
                poolCountryBitmap: 0,
                isBlackList: false
            })
        );

        IComplianceRule.RuleV2[] memory rules = policy.getRulesV2(address(listed));
        assertEq(rules.length, 2);
        assertEq(rules[0].minSubTier, 70);
        assertEq(rules[1].minSubTier, 9);
        assertEq(rules[1].allowedSubGroup, bytes2(0x4344));

        // Fails the first cohort on sub-tier, satisfies the second on group.
        policy.setCredential(alice, bytes2(0), GROUP_CD, 20, 9, 0);
        assertTrue(policy.canTransfer(address(listed), address(0), alice, 1));
    }

    // ---- differential: the token honours exactly what the policy allows -------

    /// @dev Fuzzed over sub-tiers on both sides. A transfer must succeed if and only if
    ///      `canTransfer` says so - no gap in either direction, which is the on-chain half
    ///      of the claim the off-chain property tests make.
    function testFuzz_transferAgreesWithPolicy(uint8 senderSubTier, uint8 receiverSubTier) public {
        senderSubTier = uint8(bound(senderSubTier, 0, 99));
        receiverSubTier = uint8(bound(receiverSubTier, 0, 99));

        address sender = address(0x5E4DE7);
        address receiver = address(0x4ECE1);
        _credential(sender, 20, senderSubTier);
        _credential(receiver, 20, receiverSubTier);

        // Fund the sender while the rules still permit it.
        policy.setCredential(sender, bytes2(0), GROUP_CD, 20, 99, 0);
        listed.mint(sender, 100);
        _credential(sender, 20, senderSubTier);

        bool allowed = policy.canTransfer(address(listed), sender, receiver, 1);

        vm.prank(sender);
        if (allowed) {
            listed.transfer(receiver, 1);
            assertEq(listed.balanceOf(receiver), 1);
        } else {
            vm.expectRevert(IATokenPolicy.TransferNotAllowed.selector);
            listed.transfer(receiver, 1);
        }
    }
}
