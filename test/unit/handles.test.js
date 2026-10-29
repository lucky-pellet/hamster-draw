// The X giveaway helper: handles out of messy pastes. Imports the web module as shipped.
import assert from "node:assert/strict";
import { parseEntries } from "../../web/src/lib/entries.js";
import { DROP_REASONS, extractHandles, readHost, SAMPLE_HOST, SAMPLE_THREAD } from "../../web/src/lib/handles.js";

/** The dropped list as "reason text xcount" strings, easier to read in a failure. */
const drops = (result) => result.dropped.map((d) => `${d.reason} ${d.text} x${d.count}`);

describe("X giveaway helper (handle extraction)", function () {
  it("counts who replied in a copied reply thread, not who they tagged or replied to", function () {
    const result = extractHandles(SAMPLE_THREAD, { host: SAMPLE_HOST });
    assert.equal(result.readAs, "posts");
    assert.deepEqual(result.handles, [
      "@nadia_nights",
      "@Wheel_Watch_42", // first spelling wins over the later @wheel_watch_42
      "@seed_vault_dao",
      "@midnite_sprint",
      "@auntie_squeek",
      "@sunflower_steve", // from a one-line "Name @handle · 12m" header
    ]);
    assert.deepEqual(drops(result), [
      "host @pellet_baron x9", // own post, seven "Replying to" lines and a fullwidth ＠ mention
      "repeat @Wheel_Watch_42 x2",
      "tagged @squeekchain x1",
      "tagged @gus_streamchat x1",
      "tagged @cheek_pouch_cap x1",
      "tagged @Bea_the_mod x1",
      "too-long @auntie_squeek_official_account x1",
      "bad-chars @zoë_squeeks x1",
      "email vault@seedvault.example x1",
    ]);
    assert.equal(result.taggedCounted, false);
    assert.equal(result.taggedFound, true);
    assert.equal(result.busiest, null, "no guess needed once the host is given");
    for (const d of result.dropped) assert.ok(DROP_REASONS[d.reason], `${d.reason} has wording`);
  });

  it("guesses the host from copied posts, and counts tagged handles when asked", function () {
    const unhosted = extractHandles(SAMPLE_THREAD);
    assert.deepEqual(unhosted.busiest, { handle: "@pellet_baron", count: 9 });
    assert.equal(unhosted.handles[0], "@pellet_baron", "without a host, the giveaway post's author is an entry");

    const everyone = extractHandles(SAMPLE_THREAD, { host: "https://x.com/Pellet_Baron", tagged: true });
    assert.equal(everyone.taggedCounted, true);
    assert.deepEqual(everyone.handles, [
      "@squeekchain",
      "@nadia_nights",
      "@gus_streamchat",
      "@Wheel_Watch_42",
      "@cheek_pouch_cap",
      "@Bea_the_mod",
      "@seed_vault_dao",
      "@midnite_sprint",
      "@auntie_squeek",
      "@sunflower_steve",
    ]);
    assert.equal(everyone.host, "@Pellet_Baron");
  });

  it("keeps a handle that only appears after 'Replying to' out, with its own reason", function () {
    const thread = [
      "Pellet Baron @pellet_baron · Oct 28",
      "Raffle! Reply to enter",
      "Gus @gus_streamchat · 3h",
      "Replying to @pellet_baron, @lurker_lou and 2 others",
      "me!!",
      "Bea @Bea_the_mod · 2h",
      "Replying to",
      "@Pellet_Baron",
      "and",
      "@GUS_STREAMCHAT",
      "",
      "in",
    ].join("\r\n");
    const result = extractHandles(thread, { host: "pellet_baron" });
    assert.deepEqual(result.handles, ["@gus_streamchat", "@Bea_the_mod"]);
    assert.deepEqual(drops(result), ["host @pellet_baron x3", "replying @lurker_lou x1"]);
  });

  it("reads reposts and likes lists by their Follow buttons, ignoring handles in bios", function () {
    const reposts = [
      "Seed Vault DAO",
      "@seed_vault_dao",
      "Follow",
      "We stack seeds. Building with @squeekchain and @wheel_labs",
      "Auntie Squeek",
      "@auntie_squeek",
      "Follows you",
      "Auntie to every hamster on @squeekchain.",
    ].join("\n");
    const result = extractHandles(reposts);
    assert.equal(result.readAs, "posts");
    assert.deepEqual(result.handles, ["@seed_vault_dao", "@auntie_squeek"]);
    assert.deepEqual(drops(result), ["tagged @squeekchain x2", "tagged @wheel_labs x1"]);
  });

  it("counts every handle in a plain list, however it is numbered, bulleted or separated", function () {
    const list = [
      "Entries from the Discord:",
      "1. @Alice_ETH",
      "2) @bob ✅",
      "- @carol_",
      "• @dave , @erin & @frank",
      "@alice_eth",
      "#4 @gus and @hana;@ivy",
      "  @abcdefghijklmnop",
    ].join("\n");
    const result = extractHandles(list);
    assert.equal(result.readAs, "list");
    assert.deepEqual(result.handles, ["@Alice_ETH", "@bob", "@carol_", "@dave", "@erin", "@frank", "@gus", "@hana", "@ivy"]);
    assert.deepEqual(drops(result), ["repeat @Alice_ETH x2", "too-long @abcdefghijklmnop x1"]);
  });

  it("counts mentions in prose when nothing looks like copied posts", function () {
    const result = extractHandles("Congrats to @alice, @bob and @Carol_!\nHosted by @host_hq. Ping (@dave) or .@erin\nalso @alice.", {
      host: "@HOST_HQ",
    });
    assert.equal(result.readAs, "list");
    assert.equal(result.taggedCounted, true);
    assert.deepEqual(result.handles, ["@alice", "@bob", "@Carol_", "@dave", "@erin"]);
    assert.deepEqual(drops(result), ["host @HOST_HQ x1", "repeat @alice x2"]);
  });

  it("follows X's handle rules: 1 to 15 of A-Z, 0-9 and _, not glued to the word before", function () {
    const text = [
      "@abcdefghijklmno", // 15: fine
      "@abcdefghijklmnop", // 16: too long
      "@_ @9",
      "@josé and @zoë", // accented letters (composed and combining) glued on: X would not link either
      "@aliceさん", // other scripts glued on end the mention, as on X
      "bob@example.com mail@sub.example.co.uk",
      "see you @ 9pm, ＠fullwidth, #@hash $@cash x@y",
      "https://example.com/@not_x",
      "🐹@hamster_fan \u{1D400}@glued_to_a_letter", // an emoji before @ is fine; an astral letter glues it
    ].join("\n");
    const result = extractHandles(text);
    assert.deepEqual(result.handles, ["@abcdefghijklmno", "@_", "@9", "@alice", "@fullwidth", "@hamster_fan"]);
    assert.deepEqual(drops(result), [
      "too-long @abcdefghijklmnop x1",
      "bad-chars @josé x1",
      "bad-chars @zoë x1",
      "email bob@example.com x1",
      "email mail@sub.example.co.uk x1",
    ]);
  });

  it("reads x.com and twitter.com links as their profile's handle", function () {
    const links = [
      "https://x.com/Alice_ETH/status/1850000000000000000",
      "https://twitter.com/bob?s=21",
      "x.com/carol_",
      "mobile.twitter.com/erin/",
      "https://x.com/i/status/123",
      "https://x.com/alice_eth",
      "https://x.com/an_account_name_that_is_long",
    ].join("\n");
    const result = extractHandles(links);
    assert.deepEqual(result.handles, ["@Alice_ETH", "@bob", "@carol_", "@erin"]);
    assert.deepEqual(drops(result), [
      "repeat @Alice_ETH x2",
      "too-long @an_account_name_that_is_long x1",
      "not-profile https://x.com/i/status/123 x1",
    ]);
  });

  it("reads a list with no @ at all as bare handles, one per line or comma", function () {
    const column = "alice_eth\nBob\r\ncarol_, dave;erin\n\nCarol from the Discord\nthis_handle_is_too_long\n  1. frank\n- gus\nALICE_ETH\n";
    const result = extractHandles(column);
    assert.equal(result.readAs, "bare");
    assert.deepEqual(result.handles, ["@alice_eth", "@Bob", "@carol_", "@dave", "@erin", "@frank", "@gus"]);
    assert.deepEqual(drops(result), ["repeat @alice_eth x2", "too-long this_handle_is_too_long x1", "not-handle Carol from the Discord x1"]);
  });

  it("strips invisible marks that ride along with copied text", function () {
    const result = extractHandles("⁦@nadia_nights⁩\n@ali​ce_eth\n﻿@bob‎");
    assert.deepEqual(result.handles, ["@nadia_nights", "@alice_eth", "@bob"]);
    assert.deepEqual(result.dropped, []);
  });

  it("reads the host field leniently and flags one X would not accept", function () {
    assert.deepEqual(readHost(" @Pellet_Baron "), { key: "pellet_baron", name: "Pellet_Baron", problem: null });
    assert.equal(readHost("pellet_baron").key, "pellet_baron");
    assert.equal(readHost("https://twitter.com/pellet_baron/").key, "pellet_baron");
    assert.equal(readHost("＠pellet_baron").key, "pellet_baron");
    assert.deepEqual(readHost(""), { key: null, name: null, problem: null });
    assert.equal(readHost("pellet baron").problem, "not-handle");
    assert.equal(readHost("@this_is_sixteen_").problem, "not-handle");

    const result = extractHandles("@a\n@b", { host: "not a handle" });
    assert.equal(result.hostProblem, "not-handle");
    assert.deepEqual(result.handles, ["@a", "@b"], "an unreadable host leaves everyone in");
  });

  it("hands the raffle form a list it keeps exactly as is", function () {
    for (const text of [SAMPLE_THREAD, "@x @X @x_ @X_", "a\nb\nc"]) {
      const { handles } = extractHandles(text, { host: SAMPLE_HOST });
      const parsed = parseEntries(handles.join("\n"));
      assert.deepEqual(parsed.entries, handles);
      assert.deepEqual(parsed.duplicates, []);
      assert.deepEqual(parsed.tooLong, []);
    }
    assert.deepEqual(extractHandles("").handles, []);
    assert.equal(extractHandles("   \n ").readAs, "empty");
    assert.equal(extractHandles(null).readAs, "empty");
  });
});
