// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISqueekCore} from "./interfaces/ISqueekCore.sol";

/// @title Hamster Draw
/// @author Hamster Draw contributors
/// @notice Provably fair raffles where Squeektoshi, the hamster on the Squeekchain wheel, picks the winners.
///
/// How one raffle goes:
/// 1. A host calls `create` with a title, the full entry list and a winner count. The list is sealed:
///    its hash is stored and the list itself is emitted in `DrawCreated`, so anyone can rebuild it from logs.
///    The raffle points at `targetRound`, the round after the current one. That round has not started,
///    so nobody (the host included) can know what the wheel will record in it.
/// 2. SqueekCore settles rounds about every ten minutes. A round where the hamster did not run is certified
///    with zero work and carries no data, so the draw waits for the first round at or after `targetRound`
///    in which he actually ran (an "active" round).
/// 3. Anyone calls `draw`. The seed hashes that round's dataHash with the raffle id, the sealed entry hash,
///    the chain id and this contract's address, and the winners follow from the seed. The result does not
///    depend on who calls `draw` or when: it is fixed the moment the deciding round settles, and `draw`
///    only writes it down.
///
/// @dev No owner, no admin, no upgrade path, no funds held. The outcome is exactly as trustworthy as the
/// dataHash SqueekCore records for the deciding round.
contract HamsterDraw {
    /// @notice Everything stored for one raffle.
    struct Draw {
        address host; // account that called create
        uint64 targetRound; // first round allowed to decide the raffle (currentRound + 1 at create time)
        uint16 winners; // how many distinct entries win
        uint16 entryCount; // number of entries in the sealed list
        uint64 createdAt; // block timestamp of create
        uint64 createdBlock; // block of create: the DrawCreated log with the entries lives here
        uint64 drawnRound; // active round that decided the raffle; 0 while undrawn
        uint64 drawnBlock; // block of draw: the Drawn log lives here; 0 while undrawn
        bytes32 entriesHash; // keccak256(abi.encode(entries))
        bytes32 dataHash; // drawnRound's dataHash on SqueekCore; 0 while undrawn
        bytes32 seed; // keccak256(abi.encode(dataHash, id, entriesHash, block.chainid, address(this))); 0 while undrawn
        string title;
    }

    /// @notice Where a raffle stands right now.
    enum Status {
        WaitingForRound, // the target round is not settled yet
        HamsterAsleep, // settled through the target, but every round since was zero work
        ReadyToDraw, // an active round at or after the target is settled: the result is fixed, anyone may draw
        Drawn // winners are written onchain
    }

    uint256 public constant MAX_TITLE_BYTES = 80;
    uint256 public constant MIN_ENTRIES = 2;
    uint256 public constant MAX_ENTRIES = 1000;
    uint256 public constant MAX_ENTRY_BYTES = 64;
    uint256 public constant MAX_WINNERS = 50;

    /// @notice The SqueekCore ledger whose rounds decide every raffle here.
    ISqueekCore public immutable core;
    /// @notice Start of round 1, copied from the core's configuration at deployment.
    uint64 public immutable genesisTimestamp;
    /// @notice Round length in seconds, copied from the core's configuration at deployment.
    uint64 public immutable roundDuration;

    uint256 private _drawCount;
    mapping(uint256 id => Draw) private _draws;

    /// @notice A raffle was opened. `entries` is the complete sealed list, in pick order (index 0 first).
    event DrawCreated(
        uint256 indexed id,
        address indexed host,
        string title,
        string[] entries,
        uint16 winners,
        uint64 targetRound,
        bytes32 entriesHash
    );

    /// @notice A raffle was decided by active round `roundId`. Read the picks with `winnersOf(id)`.
    event Drawn(uint256 indexed id, uint64 roundId, bytes32 dataHash, bytes32 seed);

    /// @notice The core reported a round duration of zero.
    error InvalidRoundDuration();
    /// @notice Titles must be 1 to 80 bytes of UTF-8.
    error InvalidTitleLength(uint256 length);
    /// @notice A raffle needs 2 to 1000 entries.
    error InvalidEntryCount(uint256 count);
    /// @notice Entry `index` is empty or longer than 64 bytes.
    error InvalidEntryLength(uint256 index, uint256 length);
    /// @notice Winners must be at least 1, fewer than the entries, and at most 50.
    error InvalidWinnerCount(uint256 winners, uint256 entryCount);
    /// @notice No raffle has this id.
    error UnknownDraw(uint256 id);
    /// @notice The raffle was already decided by `drawnRound`.
    error AlreadyDrawn(uint256 id, uint64 drawnRound);
    /// @notice The raffle has not been drawn yet, so it has no winners.
    error NotDrawnYet(uint256 id);
    /// @notice SqueekCore has not settled `targetRound` yet. Try again after the next settlement.
    error NotSettledYet(uint64 targetRound, uint64 settledThroughRound);
    /// @notice Every settled round from `targetRound` through `settledThroughRound` had zero work.
    error HamsterStillAsleep(uint64 targetRound, uint64 settledThroughRound);

    /// @param squeekCore The SqueekCore proxy. Its genesis time and round length are copied here once.
    constructor(ISqueekCore squeekCore) {
        ISqueekCore.CoreConfiguration memory cfg = squeekCore.configuration();
        if (cfg.roundDuration == 0) revert InvalidRoundDuration();
        core = squeekCore;
        genesisTimestamp = cfg.genesisTimestamp;
        roundDuration = cfg.roundDuration;
    }

    // ---------------------------------------------------------------------------------------------
    // Raffle lifecycle
    // ---------------------------------------------------------------------------------------------

    /// @notice Opens a raffle and seals its entry list.
    /// @dev Entries are not deduplicated here: listing a name twice gives it two tickets.
    /// @param title 1 to 80 bytes.
    /// @param entries 2 to 1000 entries, each 1 to 64 bytes. Their order is the index order of `winnersOf`.
    /// @param winners How many distinct entries win: at least 1, below the entry count, at most 50.
    /// @return id The new raffle's id. Ids start at 1.
    function create(string calldata title, string[] calldata entries, uint16 winners) external returns (uint256 id) {
        _checkInput(title, entries, winners);

        bytes32 entriesHash = keccak256(abi.encode(entries));
        uint64 targetRound = currentRound() + 1;
        id = ++_drawCount;

        Draw storage d = _draws[id];
        d.host = msg.sender;
        d.targetRound = targetRound;
        d.winners = winners;
        d.entryCount = uint16(entries.length);
        d.createdAt = uint64(block.timestamp);
        d.createdBlock = uint64(block.number);
        d.entriesHash = entriesHash;
        d.title = title;

        emit DrawCreated(id, msg.sender, title, entries, winners, targetRound, entriesHash);
    }

    /// @notice Decides raffle `id` from the first active round at or after its target round.
    /// @dev Permissionless and caller-independent: everyone who calls it after the deciding round settles
    /// gets the same seed. Reverts while the target is unsettled or while the hamster has not run since.
    /// @return seed The seed the winners are derived from.
    function draw(uint256 id) external returns (bytes32 seed) {
        Draw storage d = _existing(id);
        if (d.drawnRound != 0) revert AlreadyDrawn(id, d.drawnRound);

        uint64 target = d.targetRound;
        uint64 settled = core.state().settledThroughRound;
        if (settled < target) revert NotSettledYet(target, settled);

        (bool found, uint64 roundId, bytes32 dataHash) = _firstActiveAfter(target - 1, settled);
        if (!found) revert HamsterStillAsleep(target, settled);

        seed = keccak256(abi.encode(dataHash, id, d.entriesHash, block.chainid, address(this)));
        d.drawnRound = roundId;
        d.drawnBlock = uint64(block.number);
        d.dataHash = dataHash;
        d.seed = seed;

        emit Drawn(id, roundId, dataHash, seed);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @notice The round the wall clock is in: floor((now - genesis) / roundDuration) + 1, or 0 before genesis.
    function currentRound() public view returns (uint64) {
        if (block.timestamp < genesisTimestamp) return 0;
        return uint64((block.timestamp - genesisTimestamp) / roundDuration) + 1;
    }

    /// @notice The first settled round after `afterRound` in which the hamster ran.
    /// @dev Searches up to the core's settledThroughRound. Rounds past the frontier are unknown, not empty.
    /// @return found Whether such a round is settled yet.
    /// @return roundId The round, or 0.
    /// @return dataHash Its dataHash, or 0.
    function firstActiveRoundAfter(uint64 afterRound)
        external
        view
        returns (bool found, uint64 roundId, bytes32 dataHash)
    {
        return _firstActiveAfter(afterRound, core.state().settledThroughRound);
    }

    /// @notice One-call summary for frontends.
    /// @return status Where the raffle stands.
    /// @return settledThroughRound The core's certified frontier right now.
    /// @return roundId The deciding round when Drawn or ReadyToDraw, else 0.
    /// @return dataHash That round's dataHash when Drawn or ReadyToDraw, else 0.
    function statusOf(uint256 id)
        external
        view
        returns (Status status, uint64 settledThroughRound, uint64 roundId, bytes32 dataHash)
    {
        Draw storage d = _existing(id);
        settledThroughRound = core.state().settledThroughRound;
        if (d.drawnRound != 0) return (Status.Drawn, settledThroughRound, d.drawnRound, d.dataHash);

        uint64 target = d.targetRound;
        if (settledThroughRound < target) return (Status.WaitingForRound, settledThroughRound, 0, bytes32(0));

        bool found;
        (found, roundId, dataHash) = _firstActiveAfter(target - 1, settledThroughRound);
        status = found ? Status.ReadyToDraw : Status.HamsterAsleep;
    }

    /// @notice The winning entry indices (0-based, in pick order) of a drawn raffle.
    /// @dev Pick i is keccak256(abi.encode(seed, i, attempt)) % entryCount for attempt = 0, 1, ...,
    /// taking the first index not already picked.
    function winnersOf(uint256 id) external view returns (uint32[] memory) {
        Draw storage d = _existing(id);
        if (d.drawnRound == 0) revert NotDrawnYet(id);
        return _pick(d.seed, d.winners, d.entryCount);
    }

    /// @notice The pick rule on its own, for checking a seed by hand.
    function pickWinners(bytes32 seed, uint256 winners, uint256 entryCount) external pure returns (uint32[] memory) {
        if (winners == 0 || winners >= entryCount || winners > MAX_WINNERS || entryCount > MAX_ENTRIES) {
            revert InvalidWinnerCount(winners, entryCount);
        }
        return _pick(seed, winners, entryCount);
    }

    /// @notice The stored record of raffle `id`. The entries themselves are in its DrawCreated log.
    function getDraw(uint256 id) external view returns (Draw memory) {
        return _existing(id);
    }

    /// @notice How many raffles exist. Valid ids are 1 through drawCount().
    function drawCount() external view returns (uint256) {
        return _drawCount;
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _checkInput(string calldata title, string[] calldata entries, uint16 winners) private pure {
        uint256 titleLength = bytes(title).length;
        if (titleLength == 0 || titleLength > MAX_TITLE_BYTES) revert InvalidTitleLength(titleLength);

        uint256 count = entries.length;
        if (count < MIN_ENTRIES || count > MAX_ENTRIES) revert InvalidEntryCount(count);
        for (uint256 i; i < count; ++i) {
            uint256 length = bytes(entries[i]).length;
            if (length == 0 || length > MAX_ENTRY_BYTES) revert InvalidEntryLength(i, length);
        }

        if (winners == 0 || winners >= count || winners > MAX_WINNERS) revert InvalidWinnerCount(winners, count);
    }

    function _existing(uint256 id) private view returns (Draw storage d) {
        d = _draws[id];
        if (d.host == address(0)) revert UnknownDraw(id);
    }

    /// @dev roundPage(after, through, 1) lists the first active round in (after, through], if any.
    function _firstActiveAfter(uint64 afterRound, uint64 settledThroughRound)
        private
        view
        returns (bool found, uint64 roundId, bytes32 dataHash)
    {
        if (afterRound >= settledThroughRound) return (false, 0, bytes32(0));
        ISqueekCore.RoundPage memory page = core.roundPage(afterRound, settledThroughRound, 1);
        if (page.rounds.length == 0) return (false, 0, bytes32(0));
        ISqueekCore.RoundCheckpoint memory first = page.rounds[0];
        return (true, first.roundId, first.dataHash);
    }

    /// @dev Distinct indices by rejection sampling, with a bitmap of indices already taken.
    /// Terminates because winners < entryCount always leaves a free index.
    function _pick(bytes32 seed, uint256 winners, uint256 entryCount) private pure returns (uint32[] memory picks) {
        picks = new uint32[](winners);
        uint256[] memory taken = new uint256[]((entryCount >> 8) + 1);
        for (uint256 i; i < winners; ++i) {
            for (uint256 attempt; ; ++attempt) {
                uint256 index = uint256(keccak256(abi.encode(seed, i, attempt))) % entryCount;
                uint256 word = index >> 8;
                uint256 bit = 1 << (index & 255);
                if (taken[word] & bit == 0) {
                    taken[word] |= bit;
                    picks[i] = uint32(index);
                    break;
                }
            }
        }
    }
}
