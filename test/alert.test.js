const { test } = require("node:test");
const assert = require("node:assert/strict");
const Alert = require("../claude-limits@paradoxm/lib/alert.js");
const { REAL_RESPONSE } = require("./fixtures.js");

const NOW = Math.floor(Date.parse("2026-09-02T08:00:00Z") / 1000);
const iso = (unix) => new Date(unix * 1000).toISOString();
const fresh = { fetchedAt: NOW, error: null };
const answer = (session, weekly, scoped, paid) => ({
    limits: [
        { kind: "session", percent: session, resets_at: iso(NOW + 3600) },
        { kind: "weekly_all", percent: weekly, resets_at: iso(NOW + 86400) },
        { kind: "weekly_scoped", percent: 3, resets_at: iso(NOW + 86400) },
        { kind: "weekly_scoped", percent: scoped, resets_at: iso(NOW + 86400) }
    ],
    extra_usage: { is_enabled: !!paid }
});

test("below the threshold there is a status and no alert", () => {
    const { status, alert } = Alert.report(answer(7, 40, 10), fresh, 98, NOW);
    assert.equal(alert, null);
    assert.equal(status.over_threshold, false);
    assert.equal(status.binding_window, "weekly");
});

test("the most spent per-model window counts, not the first one", () => {
    const { status } = Alert.report(answer(7, 40, 99), fresh, 98, NOW);
    assert.equal(status.weekly_model_percent, 99);
    assert.equal(status.binding_window, "weekly_model");
});

test("over the threshold names the window, the reset and the money", () => {
    const { alert } = Alert.report(answer(7, 100, 0, true), fresh, 98, NOW);
    assert.match(alert.key, /^over:weekly:/);
    assert.equal(alert.until, NOW + 86400);
    assert.match(alert.notice, /окно weekly — 100%, сброс \d\d\.\d\d \d\d:\d\d\. Дальше — за деньги/);
    assert.match(alert.text, /paid_overflow/);
});

test("on a tie the later reset binds, so a second window at 100% keeps the episode", () => {
    const one = Alert.report(answer(7, 100, 0), fresh, 98, NOW).alert;
    const two = Alert.report(answer(100, 100, 0), fresh, 98, NOW).alert;
    assert.equal(two.key, one.key);
    assert.equal(two.until, one.until);
});

test("the key survives the server's sub-second jitter of the reset", () => {
    const a = answer(7, 100, 0), b = answer(7, 100, 0);
    a.limits[1].resets_at = "2026-09-03T02:59:59.894829+00:00";
    b.limits[1].resets_at = "2026-09-03T03:00:00.101000+00:00";
    assert.equal(Alert.report(a, fresh, 98, NOW).alert.key, Alert.report(b, fresh, 98, NOW).alert.key);
});

test("a window past its reset no longer counts", () => {
    const stale = answer(7, 100, 0);
    stale.limits[1].resets_at = iso(NOW - 60);
    const { status, alert } = Alert.report(stale, fresh, 98, NOW);
    assert.equal(status.weekly_percent, null);
    assert.equal(alert, null);
});

test("a missing percent is unknown, not zero", () => {
    const w = Alert.windowsOf({ limits: [{ kind: "session" }] }, NOW);
    assert.equal(w.session.percent, null);
    assert.equal(Alert.windowsOf(REAL_RESPONSE, NOW).weekly.percent, 8);
});

test("blindness is said only when it is real", () => {
    const failing = { fetchedAt: NOW - 4000, error: { code: "http" } };
    assert.match(Alert.report(answer(7, 40, 0), failing, 98, NOW).alert.key, /^blind:http/);
    // A recent answer is still good enough
    assert.equal(Alert.report(answer(7, 40, 0), { fetchedAt: NOW - 600, error: { code: "http" } },
                              98, NOW).alert, null);
    // No answer yet and no failure: the first request is on its way
    assert.equal(Alert.report(null, { fetchedAt: 0, error: null }, 98, NOW).alert, null);
    // An expired token is the normal state of a closed Claude Code
    assert.equal(Alert.report(null, { fetchedAt: 0, error: { code: "token-expired" } }, 98, NOW).alert,
                 null);
});

test("a stop beats blindness: old figures past the threshold still stop", () => {
    const failing = { fetchedAt: NOW - 4000, error: { code: "http" } };
    assert.match(Alert.report(answer(7, 100, 0), failing, 98, NOW).alert.key, /^over:/);
});
