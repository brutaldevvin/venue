// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IComplianceRule {
    /// @notice Within a rule the fields are AND; across `RuleV2[]` the rules are OR.
    ///         Zero (or 0x0000) means unrestricted in every field.
    ///
    /// @dev Complete shape confirmed by the Cleanverse team. `isBlackList` sits before
    ///      `countryBitmap`; omitting it corrupts country handling and misaligns multi-rule
    ///      decodes because each tuple has six ABI words, not five.
    struct RuleV2 {
        bytes2 allowedGroup;
        bytes2 allowedSubGroup;
        uint8 minTier; // 0-99
        uint8 minSubTier; // 0-99
        bool isBlackList; // true = deny the listed countries; false = allow only them
        uint256 countryBitmap; // country membership, as an opaque bit index
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
