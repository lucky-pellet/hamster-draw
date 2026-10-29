// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISqueekCore} from "../interfaces/ISqueekCore.sol";

/// @title MockSqueekCore
/// @notice Test double for SqueekCore V3's read surface. `settle` stands in for the Reporter's signed
/// `submitRounds` (no signature), and the reads follow the documented V3 rules:
/// - a settlement lists active rounds only; every omitted round up to the new frontier is zero work;
/// - the new frontier must advance and its round must have ended by wall-clock time;
/// - each active round is priced at the current difficulty, then steers it ("price first, then steer");
/// - roundPage returns up to maxRecords active rounds in (afterRound, throughRound]; when the budget would
///   leave one out, the page stops just before it and certifiedThroughRound says where it stopped.
/// @dev Test-only. Never deploy it anywhere that matters.
contract MockSqueekCore is ISqueekCore {
    /// @notice One active round handed to `settle`.
    struct MockRound {
        uint64 roundId;
        uint64 work;
        bytes32 dataHash;
    }

    error InvalidRoundPageBounds();
    error BatchTooLarge();
    error InvalidActiveRound();
    error NonIncreasingRoundId();
    error InvalidRoundId();
    error WorkExceeded();
    error SettledThroughRoundNotAdvanced();
    error RoundNotElapsed();

    uint256 private constant MAX_RECORDS = 16;
    uint96 private constant UNITS_PER_BLOCK = 1_000_000_000;
    uint64 private constant STEERING_TARGET = 40;
    uint64 private constant SMOOTHING = 30;

    CoreConfiguration private _config;
    uint64 private _settled;
    uint256 private _nonce;
    LedgerPosition private _head;
    RoundCheckpoint[] private _checkpoints; // active rounds, ascending roundId

    constructor(uint64 genesisTimestamp, uint64 roundDuration) {
        _config.streamId = keccak256("mock squeek wheel");
        _config.genesisTimestamp = genesisTimestamp;
        _config.roundDuration = roundDuration;
        _config.maxWorkPerRound = 10_000;
        _config.maxRoundsPerBatch = uint16(MAX_RECORDS);
        _config.guardian = msg.sender;
        _config.reporter = msg.sender;
        _config.initialWorkPerThousandBlocks = 10_000;
        _config.targetBlocksPerActiveRound = STEERING_TARGET;
        _config.difficultySmoothingRounds = SMOOTHING;
        _config.blockUnitsPerBlock = UNITS_PER_BLOCK;
        _head.workPerThousandBlocks = 10_000;
    }

    /// @notice Certifies every round through `settledThroughRound`; `rounds` lists the active ones.
    function settle(MockRound[] calldata rounds, uint64 settledThroughRound) external {
        if (rounds.length > MAX_RECORDS) revert BatchTooLarge();
        if (settledThroughRound <= _settled) revert SettledThroughRoundNotAdvanced();
        if (block.timestamp < uint256(_config.genesisTimestamp) + uint256(settledThroughRound) * _config.roundDuration) {
            revert RoundNotElapsed();
        }

        LedgerPosition memory p = _head;
        uint64 previous = _settled;
        for (uint256 i; i < rounds.length; ++i) {
            MockRound calldata r = rounds[i];
            if (r.work == 0 || r.dataHash == bytes32(0)) revert InvalidActiveRound();
            if (r.roundId <= previous) {
                if (i == 0) revert InvalidRoundId(); // already settled
                revert NonIncreasingRoundId();
            }
            if (r.roundId > settledThroughRound) revert InvalidRoundId();
            if (r.work > _config.maxWorkPerRound) revert WorkExceeded();

            // Price first, then steer.
            p.cumulativeBlockUnits += uint96((uint256(r.work) * 1e12) / p.workPerThousandBlocks);
            p.cumulativeWork += r.work;
            if (r.work >= STEERING_TARGET) {
                p.workPerThousandBlocks = uint32(
                    ((SMOOTHING - 1) * uint256(p.workPerThousandBlocks) + (uint256(r.work) * 1000) / STEERING_TARGET)
                        / SMOOTHING
                );
            }
            _checkpoints.push(
                RoundCheckpoint({
                    roundId: r.roundId,
                    cumulativeWork: p.cumulativeWork,
                    cumulativeBlockUnits: p.cumulativeBlockUnits,
                    workPerThousandBlocks: p.workPerThousandBlocks,
                    dataHash: r.dataHash
                })
            );
            previous = r.roundId;
        }

        _head = p;
        _settled = settledThroughRound;
        ++_nonce;
    }

    function state() external view returns (CoreState memory s) {
        s.settledThroughRound = _settled;
        s.cumulativeWork = _head.cumulativeWork;
        s.cumulativeBlockUnits = _head.cumulativeBlockUnits;
        s.blockHeight = uint64(_head.cumulativeBlockUnits / UNITS_PER_BLOCK);
        s.blockProgress = _head.cumulativeBlockUnits % UNITS_PER_BLOCK;
        s.workPerThousandBlocks = _head.workPerThousandBlocks;
        s.authorizationNonce = _nonce;
        s.paused = false;
    }

    function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords)
        external
        view
        returns (RoundPage memory page)
    {
        if (afterRound > throughRound || throughRound > _settled || maxRecords > MAX_RECORDS) {
            revert InvalidRoundPageBounds();
        }

        uint256 first = _firstIndexAfter(afterRound);
        uint256 next = first;
        uint64 certified = throughRound;
        uint256 n = _checkpoints.length;
        while (next < n && _checkpoints[next].roundId <= throughRound) {
            if (next - first == maxRecords) {
                // The budget would leave this active round out: stop just before it.
                certified = _checkpoints[next].roundId - 1;
                break;
            }
            ++next;
        }

        page.certifiedThroughRound = certified;
        page.start = _positionBefore(first);
        page.end = _positionBefore(next);
        page.rounds = new RoundCheckpoint[](next - first);
        for (uint256 i; i < next - first; ++i) {
            page.rounds[i] = _checkpoints[first + i];
        }
    }

    function configuration() external view returns (CoreConfiguration memory) {
        return _config;
    }

    /// @dev Index of the first checkpoint with roundId > round (binary search).
    function _firstIndexAfter(uint64 round) private view returns (uint256 lo) {
        uint256 hi = _checkpoints.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (_checkpoints[mid].roundId <= round) lo = mid + 1;
            else hi = mid;
        }
    }

    /// @dev Ledger position after the first `count` active rounds (the launch position for 0).
    function _positionBefore(uint256 count) private view returns (LedgerPosition memory p) {
        if (count == 0) return LedgerPosition(0, 0, _config.initialWorkPerThousandBlocks);
        RoundCheckpoint storage c = _checkpoints[count - 1];
        return LedgerPosition(c.cumulativeWork, c.cumulativeBlockUnits, c.workPerThousandBlocks);
    }
}
