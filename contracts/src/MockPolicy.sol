// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IATokenPolicy, IComplianceRule} from "./IATokenPolicy.sol";

/// @notice Build-time stand-in for the deployed CCP policy (decision D3).
///
/// Two reasons it exists rather than building straight against `0xaC7e...1792`:
/// registration has a review step outside our control, and the property tests need
/// adversarial rule sets we author. `Listed.sol` takes the policy as a constructor
/// argument, so switching between this and the real one is one parameter.
///
/// `strictMode` reproduces the deployed policy's actual behaviour - a bare revert instead
/// of `false` - so the try/catch in every call site is exercised rather than assumed.
contract MockPolicy is IATokenPolicy {
    struct Credential {
        bytes2 group;
        bytes2 subGroup;
        uint8 tier;
        uint8 subTier;
        uint256 countryBitmap;
        bool exists;
    }

    mapping(address => RuleV2[]) private _rules;
    mapping(address => Credential) private _credentials;

    /// @notice When true, refuse by reverting rather than returning false - which is what
    ///         the real policy does. Off by default so tests can read the boolean directly.
    bool public strictMode;

    function setStrictMode(bool on) external {
        strictMode = on;
    }

    function setCredential(
        address holder,
        bytes2 group,
        bytes2 subGroup,
        uint8 tier,
        uint8 subTier,
        uint256 countryBitmap
    ) external {
        _credentials[holder] = Credential(group, subGroup, tier, subTier, countryBitmap, true);
    }

    function clearCredential(address holder) external {
        delete _credentials[holder];
    }

    /// @notice Stands in for the CVI registry read. The deployed policy exposes no such
    ///         getter - there, credentials come from `query_apass` and only the pass/fail
    ///         answer is on-chain. The console reads this to render the rule strip, and
    ///         reads `canTransfer` for every decision that matters (D6).
    function getCredential(address holder)
        external
        view
        returns (bytes2 group, bytes2 subGroup, uint8 tier, uint8 subTier, uint256 countryBitmap, bool exists)
    {
        Credential memory c = _credentials[holder];
        return (c.group, c.subGroup, c.tier, c.subTier, c.countryBitmap, c.exists);
    }

    // ---- rule administration -------------------------------------------------

    function setRuleV2(address token, RuleV2 calldata rule) public {
        delete _rules[token];
        _rules[token].push(rule);
    }

    function addRuleV2(address token, RuleV2 calldata rule) public {
        _rules[token].push(rule);
    }

    function removeRuleV2(address token, uint256 index) public {
        RuleV2[] storage rs = _rules[token];
        require(index < rs.length, "index");
        rs[index] = rs[rs.length - 1];
        rs.pop();
    }

    function setRuleV2FromToken(RuleV2 calldata rule) external {
        setRuleV2(msg.sender, rule);
    }

    function addRuleV2FromToken(RuleV2 calldata rule) external {
        addRuleV2(msg.sender, rule);
    }

    function removeRuleV2FromToken(uint256 index) external {
        removeRuleV2(msg.sender, index);
    }

    function getRulesV2(address token) external view returns (RuleV2[] memory) {
        return _rules[token];
    }

    // ---- evaluation ----------------------------------------------------------

    /// @dev All five fields are AND within one rule.
    function _matches(Credential memory c, RuleV2 memory r) private pure returns (bool) {
        if (r.allowedGroup != bytes2(0) && c.group != r.allowedGroup) return false;
        if (r.allowedSubGroup != bytes2(0) && c.subGroup != r.allowedSubGroup) return false;
        if (r.minTier != 0 && c.tier < r.minTier) return false;
        if (r.minSubTier != 0 && c.subTier < r.minSubTier) return false;
        if (r.poolCountryBitmap != 0 && (c.countryBitmap & r.poolCountryBitmap) == 0) return false;
        return true;
    }

    /// @dev OR across the array. No rules means the policy does not govern this token, so
    ///      it transfers as a plain ERC-20.
    function _eligible(address token, address holder) private view returns (bool) {
        RuleV2[] storage rs = _rules[token];
        if (rs.length == 0) return true;

        Credential memory c = _credentials[holder];
        if (!c.exists) return false;

        for (uint256 i = 0; i < rs.length; i++) {
            if (_matches(c, rs[i])) return true;
        }
        return false;
    }

    function canTransfer(address token, address from, address to, uint256)
        external
        view
        returns (bool)
    {
        // Mint and burn have a zero counterparty, which holds no credential and is never
        // asked for one.
        bool ok = (from == address(0) || _eligible(token, from))
            && (to == address(0) || _eligible(token, to));

        if (!ok && strictMode) revert TransferNotAllowed();
        return ok;
    }
}
