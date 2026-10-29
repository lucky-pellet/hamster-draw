import assert from "node:assert/strict";
import { byteLength, cleanEntry, LIMITS, looksCommaSeparated, maxWinnersFor, parseEntries } from "../../web/src/lib/entries.js";

describe("entry parsing (create form)", function () {
  it("trims, skips blanks and keeps the first spelling of repeats", function () {
    const text = "  @Alice \n\n@bob\n@alice\nCarol   from  the Discord\n0xABCDEF0123456789abcdef0123456789ABCDEF01\n0xabcdef0123456789abcdef0123456789abcdef01\n\n";
    const parsed = parseEntries(text);
    assert.deepEqual(parsed.entries, [
      "@Alice",
      "@bob",
      "Carol from the Discord",
      "0xABCDEF0123456789abcdef0123456789ABCDEF01",
    ]);
    assert.equal(parsed.blank, 1);
    assert.deepEqual(
      parsed.duplicates.map((d) => [d.line, d.firstLine]),
      [[4, 1], [7, 6]],
    );
    assert.equal(parsed.tooLong.length, 0);
  });

  it("measures length in UTF-8 bytes, like the contract", function () {
    assert.equal(byteLength("abc"), 3);
    assert.equal(byteLength("é"), 2);
    const ok = "é".repeat(32); // 64 bytes
    const long = "é".repeat(33); // 66 bytes
    const parsed = parseEntries(`${ok}\n${long}\nshort`);
    assert.deepEqual(parsed.entries, [ok, "short"]);
    assert.deepEqual(parsed.tooLong, [{ line: 2, value: long, bytes: 66 }]);
  });

  it("normalises invisible differences before comparing", function () {
    assert.equal(cleanEntry("zoë"), "zoë"); // NFC
    assert.equal(cleanEntry("​bob﻿"), "bob");
    assert.deepEqual(parseEntries("zoë\nzoë\nZOË").entries, ["zoë"]);
  });

  it("handles empty input and Windows line endings", function () {
    assert.deepEqual(parseEntries(""), { entries: [], duplicates: [], tooLong: [], blank: 0 });
    assert.deepEqual(parseEntries("a\r\nb\r\n").entries, ["a", "b"]);
  });

  it("spots a comma-separated paste and caps winners like the contract", function () {
    assert.equal(looksCommaSeparated("alice, bob, carol"), true);
    assert.equal(looksCommaSeparated("alice\nbob"), false);
    assert.equal(maxWinnersFor(1), 0);
    assert.equal(maxWinnersFor(2), 1);
    assert.equal(maxWinnersFor(30), 29);
    assert.equal(maxWinnersFor(1000), LIMITS.maxWinners);
  });
});
