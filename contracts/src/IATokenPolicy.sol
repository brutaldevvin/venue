// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IComplianceRule {
    /// @notice Within a rule the fields are AND; across `RuleV2[]` the rules are OR.
    ///         Zero (or 0x0000) means unrestricted in every field.
    ///
    /// @dev Six fields, not five. The CCP integration guide documents five and omits
    ///      `isBlackList`, but the deployed policy at 0xaC7e...1792 returns six words per
    ///      rule - verified by counting the ABI words of a raw `getRulesV2` return on Monad.
    ///      With one rule a five-field decode reads correctly by luck, because the missing
    ///      field is last; with two or more rules every rule after the first misaligns.
    struct RuleV2 {
        bytes2 allowedGroup;
        bytes2 allowedSubGroup;
        uint8 minTier; // 0-99
        uint8 minSubTier; // 0-99
        uint256 poolCountryBitmap; // country membership, as an opaque bit index
        bool isBlackList; // true = deny the listed countries; false = allow only them
    }
}

interface IATokenPolicy is IComplianceRule {
    error TransferNotAllowed();

    /// @dev The deployed policy REVERTS with bare `0x` rather than returning false. Every
    ///      call site must wrap this in try/catch - see the note in Listed._update.
    function canTransfer(address token, address from, address to, uint256 amount)
        external
        view
        returns (bool);

    function setRuleV2(address token, RuleV2 calldata rule) external;
    function addRuleV2(address token, RuleV2 calldata rule) external;
    function removeRuleV2(address token, uint256 index) external;
    function setRuleV2FromToken(RuleV2 calldata rule) external;
    function addRuleV2FromToken(RuleV2 calldata rule) external;
    function removeRuleV2FromToken(uint256 index) external;
    function getRulesV2(address token) external view returns (RuleV2[] memory);
}
