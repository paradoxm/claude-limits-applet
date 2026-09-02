const { test } = require("node:test");
const assert = require("node:assert/strict");
const Format = require("../claude-limits@paradoxm/lib/format.js");
const { EN, RU } = require("../claude-limits@paradoxm/lib/strings.js");

test("formatDuration shows neither zero nor negative values", () => {
    assert.equal(Format.formatDuration(0, EN), "less than a minute");
    assert.equal(Format.formatDuration(-120, EN), "less than a minute");
    // A regression: 59 seconds used to render as "0 min", which reads as a
    // malfunction rather than a countdown.
    assert.equal(Format.formatDuration(59, EN), "less than a minute");
});

test("formatDuration steps up from minutes to hours to days", () => {
    assert.equal(Format.formatDuration(60, EN), "1 min");
    assert.equal(Format.formatDuration(2580, EN), "43 min");
    assert.equal(Format.formatDuration(3600, EN), "1 h 0 min");
    assert.equal(Format.formatDuration(5 * 3600 + 43 * 60, EN), "5 h 43 min");
    assert.equal(Format.formatDuration(7 * 86400, EN), "7 d 0 h");
    assert.equal(Format.formatDuration(2 * 86400 + 5 * 3600 + 59 * 60, EN), "2 d 5 h");
});

test("formatDuration takes its units from the language it is handed", () => {
    assert.equal(Format.formatDuration(5 * 3600 + 43 * 60, RU), "5 ч 43 мин");
    assert.equal(Format.formatDuration(30, RU), "меньше минуты");
});

test("formatAgo does not fuss over seconds in the first minute and a half", () => {
    assert.equal(Format.formatAgo(0, EN), "just now");
    assert.equal(Format.formatAgo(89, EN), "just now");
    assert.equal(Format.formatAgo(90, EN), "1 min ago");
    assert.equal(Format.formatAgo(3600, EN), "1 h 0 min ago");
    assert.equal(Format.formatAgo(90, RU), "1 мин назад");
});

test("formatClock shows local time with a leading zero", () => {
    const unix = Math.floor(Date.parse("2026-09-02T09:20:00Z") / 1000);
    const local = new Date(unix * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    assert.equal(Format.formatClock(unix), pad(local.getHours()) + ":" + pad(local.getMinutes()));

    // Local midnight must read as 00:05, not 0:5.
    assert.equal(Format.formatClock(new Date(2026, 8, 2, 0, 5, 0).getTime() / 1000), "00:05");
});

test("isSameDay tells today from tomorrow, from last month and from last year", () => {
    const now = new Date(2026, 8, 2, 14, 0, 0).getTime() / 1000;
    const at = (y, m, d, h, mi) => new Date(y, m, d, h, mi, 0).getTime() / 1000;
    assert.equal(Format.isSameDay(at(2026, 8, 2, 0, 1), now), true);
    assert.equal(Format.isSameDay(at(2026, 8, 2, 23, 59), now), true);
    assert.equal(Format.isSameDay(at(2026, 8, 3, 0, 1), now), false);
    assert.equal(Format.isSameDay(at(2026, 7, 2, 14, 0), now), false);
    assert.equal(Format.isSameDay(at(2025, 8, 2, 14, 0), now), false);
});

test("escapeMarkup keeps error text from breaking the Pango markup", () => {
    assert.equal(Format.escapeMarkup("<b>&</b>"), "&lt;b&gt;&amp;&lt;/b&gt;");
    assert.equal(Format.escapeMarkup("HTTP 429"), "HTTP 429");
    assert.equal(Format.escapeMarkup(429), "429");
});
