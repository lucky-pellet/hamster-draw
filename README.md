# Hamster Draw

Raffles and giveaways where a hamster picks the winners.

Squeektoshi runs on a wheel, and Squeekchain writes down what he does in ten-minute rounds on Sepolia.
Hamster Draw turns that into a raffle drum. You paste a list of names, handles or addresses and say how many
winners you want. The contract seals the list and points the raffle at the next round, one that has not started
yet. The winners come from the data of the first round, from that one on, in which he actually runs. Nobody can
know that data when the raffle opens, the host included, and anyone can check the result afterwards with two
hashes.

It is a small Solidity contract (no owner, no admin, holds no money) and a static web app with no build step.
You can try the rule before anything is deployed: the practice draw runs it in your browser on a round he has
already run, and every finished draw comes out of the drum one ticket at a time, ready to post on X. Running a
giveaway on X? Paste the reply thread and it pulls out the entrants. Drawing it live? The stream view puts the
reveal on your stream as a bare card.

## How it uses Squeekchain

- **SqueekCore on Sepolia** (`0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44`, read through its proxy).
  - `configuration()` once, in the HamsterDraw constructor: the genesis time and round length are copied into
    immutables, so `currentRound()` matches the core's clock exactly.
  - `state().settledThroughRound` to know which rounds are final. Rounds past it are unknown, not empty.
  - `roundPage(targetRound - 1, settledThroughRound, 1)` to find the first *active* round (one with wheel work)
    at or after a raffle's target. Zero-work rounds are never listed by the core, so a sleeping hamster simply
    delays the draw. That round's `dataHash` is the randomness.
  - For practice draws, `state()` and then `roundPage` pages walking back from the certified frontier a day
    (144 rounds) at a time, to find the newest round he actually ran in, with its work and `dataHash`. A
    shared practice link pins its round instead and re-reads it with `roundPage(r - 1, r, 1)`.
- **The web app** reads the same core straight from the RPC when it verifies a result, so the proof does not lean
  on HamsterDraw's own word.
- **The public API** (`api.squeekchain.com/v1`):
  - `/status` every 15 seconds for the live strip (awake or asleep, rpm, speed, distance today), with
    `If-None-Match` so unchanged answers come back as 304s.
  - `/core` for the live core address (prefilled on the deploy page, read by practice draws) and its round
    clock. If the API is down, practice draws use the built-in core address and say so.
  - `/measurement/stats?range=7d` for his typical day, used to guess when a sleeping hamster will be back.
  - Anything the API marks `unavailable` is shown as unknown, never as zero.

## The draw rule

```
targetRound = currentRound() + 1                      at create(), so the round has not started
decider     = first round >= targetRound with work    from SqueekCore.roundPage
seed        = keccak256(abi.encode(decider.dataHash, id, entriesHash, chainid, address(this)))
pick i      = keccak256(abi.encode(seed, i, attempt)) % entryCount,
              attempt = 0, 1, 2 ... until it lands on an index nobody has yet
```

`entriesHash` is `keccak256(abi.encode(entries))`, and the full list is in the `DrawCreated` event, so anyone can
rebuild it from logs. `draw(id)` is permissionless, and it gives the same answer whoever calls it and however
late: the result is fixed the moment the deciding round settles, and `draw` only writes it down. The contract
also exposes `firstActiveRoundAfter`, `statusOf`, `winnersOf`, `getDraw` and a pure `pickWinners` for checking a
seed by hand. The raffle page has a "Verify it yourself" panel that redoes all of it in the browser.

Limits, enforced onchain: a title of 1 to 80 bytes, 2 to 1000 entries of 1 to 64 bytes each, and 1 to 50
winners, always fewer than the entries. The form trims entries and drops repeats (ignoring case) before sealing;
the contract itself accepts repeats, which would simply mean extra tickets.

## Practice draws

With no contract in `web/config.js`, the front page is a practice booth (once a booth is deployed, it lives at
`?practice`). Paste a list, pick a winner count, and the page draws with the newest round in which he actually
ran, read straight from SqueekCore, showing that round's number, work and `dataHash`. No wallet, nothing signed,
nothing sent anywhere.

It is the contract's rule, not a lookalike: `web/src/lib/practice.js` calls the same `hashEntries`, `drawSeed`
and `pickWinners` that real raffles are verified with. Raffle id `0` and the zero address stand in for the raffle
number and the booth. No real raffle can have either (ids start at 1), so a practice seed never equals a real one.
The receipt and the "Verify it yourself" panel are the same components real raffles use, and their round check
asks SqueekCore, not this site.

A practice draw is a rehearsal, not a fair raffle, and the page says so. That round's `dataHash` was public before
the list was pasted, so a host could reorder names until the result suits them. Sealing the list before the round
starts is the whole point of a real raffle.

`test/unit/practice.test.js` imports the shipped web modules and checks them against HamsterDraw on Hardhat:
`pickWinners` for 300 random seeds and sizes (edge sizes around the 256-entry bitmap word included), and whole
practice draws for 24 random pasted lists (accents, combining marks, CJK, emoji), given a real booth's id and
address, against `getDraw` and `winnersOf`. Each run uses fresh random inputs and prints `PARITY_SEED`; set that
environment variable to replay a run. The fork test checks the practice round finder against the contract's own
`firstActiveRoundAfter` on live Sepolia.

## The reveal and sharing

Whenever a result is final (a drawn raffle, a peek at a raffle that is ready, a practice draw), the winners leave
the drum one at a time: names flicker past in a dashed slot, then the ticket lands. The first three get a full drum
roll and the rest come quickly, so even 50 winners take under ten seconds, and there is a Skip button. "Replay the
draw" runs it again. The flicker is a fixed shuffle for show; the winners are settled before it starts. With
`prefers-reduced-motion` the drum stays still and nothing flickers or slides, but the winners still arrive in
order, a beat apart.

Under a finished draw:

- **Post on X** opens X's web intent (`x.com/intent/post`) with the winners, the round and a short dataHash,
  trimmed to fit 280 characters (names go first, then the title gets shortened), plus the link. You can still edit
  or cancel it on X.
- **Copy results** copies plain text: each winner with their ticket number, one proof line with the full
  dataHash, entriesHash, seed and formula, then the link.
- **Copy link** copies the raffle link (`?id=7`). A practice draw copies a replay link instead:
  `?practice#r=375&w=3&t=...&l=...` carries the round, winner count, title and list after the `#`, which browsers
  never send to a server. Opening it draws again on that same round and lands on the same winners. A list that
  would push the link past 4,000 characters is left out, and the page asks whoever opens it to paste the list.
- **Stream view** opens the same draw as a bare card for OBS (see below).

## Giveaways on X

Most giveaways happen in a reply thread, so both the practice form and the real raffle form have a folded
helper under the entry list: "Giveaway on X? Pull the handles out of a thread". On x.com, open the post, let the
replies load, select them and copy, then paste. A quote list, a reposts or likes list, or any list of handles
works too: with or without the @, numbered, bulleted, comma-separated, or as x.com profile links. "Try a made-up
thread" fills it with a sample.

What it does with the paste (`web/src/lib/handles.js`, a pure function):

- A handle is what X accepts: 1 to 15 of A to Z, 0 to 9 and _. An @ glued to the word before it belongs to an
  email (`bob@example.com`), not a mention. A letter like é glued straight after the name means X would not link
  it, so it is dropped; text in another script (`@aliceさん`) just ends the mention, as it does on X.
- Repeats are matched ignoring case. The first spelling and the order of first appearance are kept, so the list
  it hands over is exactly the list the form would seal.
- When the paste looks like copied posts (X's "·" before the time, "Replying to" lines, Follow buttons), it
  counts the people who posted: a handle on a line of its own, or in a "Name @handle · 2h" header. Handles tagged
  inside a post, and the ones after "Replying to", stay out unless you tick "Count handles tagged inside posts
  too". Anything else is read as a list, where every handle counts.
- Your own handle in the host field (as `@name`, `name` or a profile link) is left out. If the paste looks like
  a thread and the field is empty, it offers the handle that shows up most.
- Everything left out is listed with its reason: the host, repeats (counted once), tagged only, only in a
  "Replying to" line, too long, characters X does not allow, an email, or an x.com link that is not a profile.

"Put N handles in the list" replaces the entry list. From there it is an ordinary raffle or practice draw, and
winners that are handles link to their X profiles. `test/unit/handles.test.js` feeds it messy pastes: a reply
thread copied in both of X's header layouts, a reposts list with handles in the bios, numbered and bulleted
lists, prose, profile links, a bare spreadsheet column, invisible direction marks, and the edges of the handle
rule.

## Stream view

Add `&embed=1` to a raffle link or a practice replay link and the page becomes a single card: the drum, the
one-ticket-at-a-time reveal and the round that decided it (its number, the work he ran in it, a short dataHash).
No header, no status strip, no footer. Add `&bg=transparent` too and the page behind the card is see-through,
for an OBS browser source over your stream or an iframe on another site.

- `?id=7&embed=1` follows a real raffle. Before the draw it shows where things stand (waiting for the round,
  hamster asleep, ready to draw) and checks again every 20 seconds; once someone presses Draw on the raffle page,
  the reveal plays on stream. A raffle that is already drawn plays it as soon as it loads.
- `?practice&embed=1#r=375&w=3&l=...` replays a practice draw on its pinned round. If that round cannot be read,
  it says so and does not draw, because any other round would pick other winners.
- "Stream view" under a finished draw opens the right link, and an undrawn raffle's page links to it too. The
  practice one keeps lists up to about 64,000 characters, since nobody has to post it.

In OBS, add a Browser source with the link (about 600 × 700) and tick "Refresh browser when scene becomes
active", so the reveal plays each time you cut to the scene. Opened in an ordinary tab, the page shows a short
setup note above the card; inside OBS or an iframe it does not. Skip and Replay only appear on hover or keyboard
focus. With `prefers-reduced-motion` it behaves like the main page: nothing spins or flickers, and the winners
still arrive one by one.

## Run it locally

Needs Node 20 or newer.

```bash
npm install
npm run build        # compile with solc 0.8.28 (optimizer on) and write web/artifact/HamsterDraw.json
npm test             # unit tests against MockSqueekCore, practice parity and X handle extraction, offline
npm run test:fork    # deploys next to the real SqueekCore on a fork of Sepolia's latest block (needs network)
npm run serve        # http://127.0.0.1:5104/
```

`npm run test:fork` uses `https://ethereum-sepolia-rpc.publicnode.com` unless you set `SEPOLIA_RPC_URL`. Public
RPCs only keep about the last 128 blocks of state, so the test forks the head it sees at start-up instead of
Hardhat's older default block.

Until a contract address is in `web/config.js`, the front page is the practice draw (it works straight away
against live Sepolia) with a "booth closed" sign under it. To click through every raffle state without Sepolia
ETH, run a whole booth on a local chain:

```bash
npm run demo:chain                                # terminal 1: Hardhat node on 8545
npm run demo:seed                                 # terminal 2: deploys a mock core + booth, keeps a fake wheel turning
npm run serve -- --config .local/config.js        # terminal 3: the app, pointed at the local chain
```

The demo uses 30-second rounds and opens raffles that are drawn, ready to draw, waiting on a sleeping hamster and
waiting for their round. Point a browser wallet at `http://127.0.0.1:8545` (chain id 31337) with one of the
Hardhat test accounts to open and draw raffles yourself.

## Deploy

1. **Contract.** Open `deploy.html` (locally or on your host), connect a wallet on Sepolia and follow the six
   steps. The SqueekCore address is prefilled from `/v1/core` and checked by reading its configuration. The page
   estimates gas, sends the deployment through your wallet and shows the new address and block.
2. **Config.** Paste those two values into `web/config.js` as `drawAddress` and `deployBlock`. You can also swap
   `rpcUrl` there if the public RPC rate-limits you.
3. **Site.** `web/` is the whole site. On Vercel: import the repo, framework preset "Other", root directory
   `web`, no build command. Any static host works the same way.

## Layout

```
contracts/HamsterDraw.sol           the booth
contracts/interfaces/ISqueekCore.sol the part of SqueekCore it reads
contracts/test/MockSqueekCore.sol   test double that follows the core's pagination and pricing rules
test/unit, test/fork                Hardhat + viem tests
scripts/                            artifact export, static server, local demo
web/                                index.html (booth, raffle and practice pages), deploy.html, config.js, src/, styles/
web/src/ui/practice.js              the practice booth
web/src/ui/reveal.js, proof.js      the one-ticket-at-a-time reveal; the receipt and verify panel all draws share
web/src/ui/giveaway.js              the X giveaway helper under both entry lists (web/src/lib/handles.js does the work)
web/src/ui/embed.js                 the stream view (&embed=1)
```

The web code imports Preact, htm and viem from esm.sh through an import map. `web/src/lib/raffle-math.js`,
`entries.js`, `practice.js`, `share-text.js` and `handles.js` run unchanged in Node, and the unit tests check them
against the contract (and, for the handles, against pastes).

## Honest limitations

- **The randomness is only as honest as the dataHash.** It is whatever the Squeekchain reporter settles for that
  round. A reporter colluding with a host could, in principle, choose a dataHash or settle a round as empty to
  move the draw to the next one. Hamster Draw cannot rule that out; it only guarantees that the host could not
  know the round's data when the raffle was sealed.
- **SqueekCore is upgradeable** through its governance timelock. HamsterDraw stores the proxy address, so a
  future upgrade could change what `roundPage` returns for old rounds.
- **Hosts can open several raffles** with the same list and only publish the one they like. Every raffle is
  public, and the raffle page lists the host's other raffles and flags the ones with an identical entry list, but
  people still have to look.
- **Draws can take a while.** If he sleeps all day (it happens), the raffle waits for his next run. Settlement
  also lags a closed round by 10 to 20 minutes.
- **A round ends during your transaction.** The target is fixed when the `create` transaction lands, not when you
  click. The form warns you near the end of a round.
- **Gas numbers look big, prices are tiny.** The whole entry list is logged, so a 1000-entry raffle with short
  entries took about 2.7M gas in the Hardhat tests. Live Sepolia charges more units than Hardhat's schedule for
  new contract code: deploying HamsterDraw estimated at about 10.7M gas in October 2026 (under the 16.7M
  per-transaction cap). The base fee was about 15 wei, so nearly all of the cost is the wallet's priority tip:
  about 0.016 test ETH at MetaMask's default 1.5 gwei, next to nothing with a 0.01 gwei tip.
- **Test money only.** The contract never holds prizes; hosts deliver them however they like.
- **Recent raffles are read from logs** in 50,000-block windows from `deployBlock`. If you leave `deployBlock`
  at 0 the list only looks at the last window.
- **Practice draws prove nothing about fairness.** They show the rule working on real data, nothing more: the
  round was already public. The page, the copied text and the X post all say "practice".
- **Practice links carry the list.** Anyone who has the link can read the names in it, and the same goes for a
  practice stream view link. Very long links can still be cut by apps that pass them around; the round and
  winner count are enough to redo the draw by hand with the list.
- **The X helper reads what you copied, not X.** It cannot see replies X has not loaded or has folded away
  ("Show more replies", "Show probable spam"), so open those before copying. It does not check who follows,
  reposts or likes, and it knows X's English labels only: with X in another language, handles after its
  "Replying to" are read as replies (the host field still takes you out).
- **The X helper tells posts from lists by layout.** X's "·", "Replying to" lines and Follow buttons mean copied
  posts; anything else is a list. A hand-made list with a stray "·" line gets read as posts, and the tagged
  handles box puts the rest back. Read the "Left out" list before you seal.
- **The stream view polls a real raffle** every 20 seconds, so its reveal can start up to 20 seconds after the
  draw lands. A long list of winners on a small OBS source is cut off at the bottom: give the source more height
  or more width (from about 540 px wide, 7 or more winners go into two columns).
- **The practice round finder looks back two weeks.** If he has not run in that time, the practice booth says
  so instead of drawing.

## Licence

MIT. See `LICENSE`.
