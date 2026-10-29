// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISqueekCore (read surface)
/// @notice The part of SqueekCore V3 that Hamster Draw reads. SqueekCore is the onchain
/// work ledger of the hamster wheel: settlements certify ten-minute rounds, and every
/// round with work carries a dataHash signed off by the Reporter.
/// @dev Field order matches the deployed V3 ABI exactly; do not reorder.
interface ISqueekCore {
    struct CoreState {
        uint64 settledThroughRound; // certified frontier: every round <= this is settled
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint64 blockHeight;
        uint96 blockProgress;
        uint32 workPerThousandBlocks;
        uint256 authorizationNonce;
        bool paused;
    }

    struct LedgerPosition {
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint32 workPerThousandBlocks;
    }

    struct RoundCheckpoint {
        uint64 roundId;
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint32 workPerThousandBlocks;
        bytes32 dataHash;
    }

    struct RoundPage {
        uint64 certifiedThroughRound; // last round this answer covers completely
        LedgerPosition start; // position after afterRound
        LedgerPosition end; // position after certifiedThroughRound
        RoundCheckpoint[] rounds; // active rounds only, oldest first
    }

    struct CoreConfiguration {
        bytes32 streamId;
        uint64 genesisTimestamp;
        uint64 roundDuration;
        uint64 maxWorkPerRound;
        uint16 maxRoundsPerBatch;
        address guardian;
        address reporter;
        uint32 initialWorkPerThousandBlocks;
        uint64 targetBlocksPerActiveRound;
        uint64 difficultySmoothingRounds;
        uint96 blockUnitsPerBlock;
    }

    function state() external view returns (CoreState memory);

    /// @notice Up to `maxRecords` (0..16) active rounds after `afterRound` (exclusive) through
    /// `throughRound` (inclusive, at most settledThroughRound). Zero-work rounds are never listed.
    function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords)
        external
        view
        returns (RoundPage memory);

    function configuration() external view returns (CoreConfiguration memory);
}
