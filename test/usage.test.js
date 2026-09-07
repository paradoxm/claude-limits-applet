const { test } = require("node:test");
const assert = require("node:assert/strict");
const Usage = require("../claude-limits@paradoxm/lib/usage.js");
const { REAL_RESPONSE, LEGACY_RESPONSE } = require("./fixtures.js");

const RESET_SESSION = Math.floor(Date.parse("2026-09-02T09:20:00.221436+00:00") / 1000);
const RESET_WEEK = Math.floor(Date.parse("2026-09-03T03:00:00.221457+00:00") / 1000);

test("parseIso8601 reads the response timestamp, dropping sub-second precision", () => {
    assert.equal(Usage.parseIso8601("2026-09-02T09:20:00.221436+00:00"), RESET_SESSION);
});

test("parseIso8601 yields zero where there is no time", () => {
    assert.equal(Usage.parseIso8601(null), 0);
    assert.equal(Usage.parseIso8601(""), 0);
    assert.equal(Usage.parseIso8601("not a date"), 0);
});

test("parseUsage reads the real response through the limits array", () => {
    const data = Usage.parseUsage(REAL_RESPONSE);
    assert.deepEqual(data.session, { percent: 59, resetsAt: RESET_SESSION });
    assert.deepEqual(data.weekly, { percent: 8, resetsAt: RESET_WEEK });
});

test("parseUsage does not confuse weekly_all with weekly_scoped", () => {
    // weekly_scoped sits at 0 percent in the response; taking it would report
    // weekly usage as zero forever.
    assert.equal(Usage.parseUsage(REAL_RESPONSE).weekly.percent, 8);
});

test("parseUsage falls back to five_hour and seven_day when the array is absent", () => {
    const data = Usage.parseUsage(LEGACY_RESPONSE);
    assert.equal(data.session.percent, 59);
    assert.equal(data.weekly.percent, 8);
    assert.equal(data.session.resetsAt, RESET_SESSION);
});

test("parseUsage falls back per kind, not per response", () => {
    const partial = { limits: [{ kind: "session", percent: 42, resets_at: null }],
                      seven_day: { utilization: 7, resets_at: null } };
    const data = Usage.parseUsage(partial);
    assert.equal(data.session.percent, 42);
    assert.equal(data.weekly.percent, 7);
});

test("parseUsage prefers percent but accepts utilization", () => {
    const mixed = { limits: [{ kind: "session", percent: null, utilization: 33.6 },
                             { kind: "weekly_all", percent: 0 }] };
    const data = Usage.parseUsage(mixed);
    assert.equal(data.session.percent, 34);
    assert.equal(data.weekly.percent, 0);
});

test("parseUsage survives an empty or malformed response", () => {
    assert.deepEqual(Usage.parseUsage({}),
                     { session: { percent: 0, resetsAt: 0 }, weekly: { percent: 0, resetsAt: 0 } });
    assert.equal(Usage.parseUsage(null).session.percent, 0);
    assert.equal(Usage.parseUsage({ limits: "not an array" }).session.percent, 0);
});

test("pace stays silent while the window has barely started", () => {
    // Six minutes into five hours: there is nothing to extrapolate from.
    const now = RESET_SESSION - Usage.SESSION_WINDOW + 360;
    assert.equal(Usage.pace({ percent: 4, resetsAt: RESET_SESSION }, Usage.SESSION_WINDOW, now), null);
});

test("pace stays silent without a reset time", () => {
    assert.equal(Usage.pace({ percent: 50, resetsAt: 0 }, Usage.SESSION_WINDOW, 0), null);
    assert.equal(Usage.pace(null, Usage.SESSION_WINDOW, 0), null);
});

test("pace stays silent if the reset is further away than a whole window", () => {
    const now = RESET_SESSION - Usage.SESSION_WINDOW - 60;
    assert.equal(Usage.pace({ percent: 10, resetsAt: RESET_SESSION }, Usage.SESSION_WINDOW, now), null);
});

test("pace predicts exhaustion when spending outruns the window", () => {
    // Half the window gone, 80 percent spent: the remaining fifth takes a
    // quarter of the elapsed time, which lands before the reset.
    const now = RESET_SESSION - Usage.SESSION_WINDOW / 2;
    const p = Usage.pace({ percent: 80, resetsAt: RESET_SESSION }, Usage.SESSION_WINDOW, now);
    assert.equal(p.fraction, 0.5);
    assert.equal(p.exhaustsAt, now + Math.round(20 * (Usage.SESSION_WINDOW / 2 / 80)));
    assert.ok(p.exhaustsAt < RESET_SESSION);
});

test("pace does not alarm when the limit lasts until the reset", () => {
    const now = RESET_SESSION - Usage.SESSION_WINDOW / 2;
    assert.equal(Usage.pace({ percent: 20, resetsAt: RESET_SESSION },
                            Usage.SESSION_WINDOW, now).exhaustsAt, 0);
});

test("pace reports elapsed share at zero spending without dividing by zero", () => {
    const now = RESET_WEEK - Usage.WEEK_WINDOW / 2;
    const p = Usage.pace({ percent: 0, resetsAt: RESET_WEEK }, Usage.WEEK_WINDOW, now);
    assert.equal(p.exhaustsAt, 0);
    assert.equal(p.fraction, 0.5);
});

test("the answer kept from the previous session comes back as it went in", () => {
    const restored = Usage.restoreUsage(JSON.stringify(REAL_RESPONSE));
    assert.deepEqual(restored, Usage.parseUsage(REAL_RESPONSE));
});

test("a kept answer that no longer parses is dropped, not shown as zero", () => {
    // parseUsage answers for any object at all, so an unrecognised shape would
    // otherwise render as a confident 0% — worse than showing nothing.
    assert.equal(Usage.restoreUsage(""), null);
    assert.equal(Usage.restoreUsage(null), null);
    assert.equal(Usage.restoreUsage("not json"), null);
    assert.equal(Usage.restoreUsage("{}"), null);
    assert.equal(Usage.restoreUsage(JSON.stringify({ limits: [] })), null);
    assert.equal(Usage.restoreUsage(JSON.stringify({ limits: [{ kind: "session", percent: 40 }] })),
                 null);
});

test("a kept answer survives the older response shape too", () => {
    const restored = Usage.restoreUsage(JSON.stringify(LEGACY_RESPONSE));
    assert.equal(restored.session.percent, Usage.parseUsage(LEGACY_RESPONSE).session.percent);
    assert.ok(restored.session.resetsAt > 0);
});
