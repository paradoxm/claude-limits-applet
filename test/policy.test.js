const { test } = require("node:test");
const assert = require("node:assert/strict");
const Policy = require("../claude-limits@paradoxm/lib/policy.js");

const NOW = 1788340000;
const ready = () => ({ data: {}, lastCallAt: 0, backoffUntil: 0, inFlight: false });
const opts = (over) => Object.assign({ now: NOW, manual: false, pollingEnabled: true,
                                       skipWhenIdle: false, isClaudeIdle: () => false }, over);

test("an ordinary tick goes to the network", () => {
    assert.equal(Policy.fetchDecision(ready(), opts()), "fetch");
});

test("a second request does not leave while the first is in flight", () => {
    const state = Object.assign(ready(), { inFlight: true });
    assert.equal(Policy.fetchDecision(state, opts()), "in-flight");
    assert.equal(Policy.fetchDecision(state, opts({ manual: true })), "in-flight");
});

test("switching polling off stops the timer but not the click", () => {
    assert.equal(Policy.fetchDecision(ready(), opts({ pollingEnabled: false })), "off");
    assert.equal(Policy.fetchDecision(ready(), opts({ pollingEnabled: false, manual: true })), "fetch");
});

test("the thirty-second guard is not bypassed even by a click", () => {
    const state = Object.assign(ready(), { lastCallAt: NOW - 29 });
    assert.equal(Policy.fetchDecision(state, opts()), "too-soon");
    assert.equal(Policy.fetchDecision(state, opts({ manual: true })), "too-soon");

    state.lastCallAt = NOW - Policy.MIN_REQUEST_GAP;
    assert.equal(Policy.fetchDecision(state, opts()), "fetch");
});

test("after a 429 the timer waits out the back-off while a click gets through", () => {
    const state = Object.assign(ready(), { backoffUntil: NOW + 300 });
    assert.equal(Policy.fetchDecision(state, opts()), "backoff");
    assert.equal(Policy.fetchDecision(state, opts({ manual: true })), "fetch");

    state.backoffUntil = NOW;
    assert.equal(Policy.fetchDecision(state, opts()), "fetch");
});

test("a wait the server named is the one a click cannot override", () => {
    // Our own back-off yields to a click; a Retry-After must not, because the
    // refused request comes back with the hour counted from the new attempt.
    const state = Object.assign(ready(), { serverWaitUntil: NOW + 1800 });
    assert.equal(Policy.fetchDecision(state, opts()), "rate-limited");
    assert.equal(Policy.fetchDecision(state, opts({ manual: true })), "rate-limited");

    state.serverWaitUntil = NOW;
    assert.equal(Policy.fetchDecision(state, opts({ manual: true })), "fetch");
});

test("the named wait outranks the guesses but not the switch or a live request", () => {
    const limited = { serverWaitUntil: NOW + 1800 };
    // Reported as rate limited rather than as our own back-off or as idle:
    // those would suggest a click could help.
    assert.equal(Policy.fetchDecision(Object.assign(ready(), limited,
                                                    { backoffUntil: NOW + 60 }), opts()),
                 "rate-limited");
    assert.equal(Policy.fetchDecision(Object.assign(ready(), limited, { lastCallAt: NOW }),
                                      opts({ manual: true })), "rate-limited");
    assert.equal(Policy.fetchDecision(Object.assign(ready(), limited,
                                                    { inFlight: true }), opts()),
                 "in-flight");
    assert.equal(Policy.fetchDecision(Object.assign(ready(), limited),
                                      opts({ pollingEnabled: false })), "off");
});

test("an idle Claude Code skips the poll only when the setting says so", () => {
    const asleep = { isClaudeIdle: () => true };
    const w = (over) => Policy.fetchDecision(ready(), opts(Object.assign({}, asleep, over)));
    assert.equal(w({ skipWhenIdle: true }), "idle");
    assert.equal(w({ skipWhenIdle: false }), "fetch");
    assert.equal(w({ skipWhenIdle: true, manual: true }), "fetch");
});

test("the first request happens even during idleness: there is nothing to show yet", () => {
    const state = Object.assign(ready(), { data: null });
    assert.equal(Policy.fetchDecision(state, opts({ skipWhenIdle: true,
                                                    isClaudeIdle: () => true })), "fetch");
});

test("the idle check does not run until the other guards have passed", () => {
    // It costs a blocking read from disk inside the Cinnamon process, so it
    // must not be called on a path that leads nowhere anyway.
    let calls = 0;
    const counting = { skipWhenIdle: true, isClaudeIdle: () => { calls++; return true; } };
    Policy.fetchDecision(Object.assign(ready(), { inFlight: true }), opts(counting));
    Policy.fetchDecision(ready(), opts(Object.assign({ pollingEnabled: false }, counting)));
    Policy.fetchDecision(Object.assign(ready(), { lastCallAt: NOW }), opts(counting));
    Policy.fetchDecision(Object.assign(ready(), { backoffUntil: NOW + 300 }), opts(counting));
    assert.equal(calls, 0);

    Policy.fetchDecision(ready(), opts(counting));
    assert.equal(calls, 1);
});

test("only the pauses that will not lift by themselves are shown to the user", () => {
    assert.equal(Policy.pausedReason("off"), "off");
    assert.equal(Policy.pausedReason("idle"), "idle");
    assert.equal(Policy.pausedReason("backoff"), "backoff");
    assert.equal(Policy.pausedReason("rate-limited"), "rate-limited");
    // These resolve by the next tick; there is nothing to explain.
    assert.equal(Policy.pausedReason("fetch"), null);
    assert.equal(Policy.pausedReason("too-soon"), null);
    assert.equal(Policy.pausedReason("in-flight"), null);
});

test("the back-off doubles from ten minutes to an hour and stops there", () => {
    assert.equal(Policy.nextBackoff(undefined), 1200);
    assert.equal(Policy.nextBackoff(Policy.BACKOFF_START), 1200);
    assert.equal(Policy.nextBackoff(1200), 2400);
    assert.equal(Policy.nextBackoff(2400), Policy.BACKOFF_MAX);
    assert.equal(Policy.nextBackoff(Policy.BACKOFF_MAX), Policy.BACKOFF_MAX);
});

test("the first request after start-up waits at least four seconds", () => {
    assert.equal(Policy.kickDelay(0, NOW), 4);
    assert.equal(Policy.kickDelay(NOW - 100, NOW), 4);
});

test("the first request after a Cinnamon restart waits out the remaining guard", () => {
    // Otherwise it is dropped as too-soon and the applet sits blank until the tick.
    assert.equal(Policy.kickDelay(NOW - 8, NOW), Policy.MIN_REQUEST_GAP - 8 + 1);
    assert.equal(Policy.kickDelay(NOW, NOW), Policy.MIN_REQUEST_GAP + 1);
});

test("a pause with a known end schedules the request for that end", () => {
    // Otherwise an hour-long rate limit against a ten-minute interval leaves
    // the panel blank for up to ten minutes after the endpoint recovers.
    const limited = { serverWaitUntil: NOW + 1800, backoffUntil: NOW + 1800 };
    assert.equal(Policy.resumeDelay(limited, "rate-limited", NOW),
                 1800 + Policy.RESUME_MARGIN);
    assert.equal(Policy.resumeDelay(limited, "backoff", NOW), 1800 + Policy.RESUME_MARGIN);
});

test("a pause without an end, or already over, schedules nothing", () => {
    // The interval is in charge of those; a one-shot would only duplicate it.
    assert.equal(Policy.resumeDelay(ready(), "off", NOW), 0);
    assert.equal(Policy.resumeDelay(ready(), "idle", NOW), 0);
    assert.equal(Policy.resumeDelay(ready(), "too-soon", NOW), 0);
    assert.equal(Policy.resumeDelay(ready(), "rate-limited", NOW), 0);
    assert.equal(Policy.resumeDelay({ serverWaitUntil: NOW }, "rate-limited", NOW), 0);
    assert.equal(Policy.resumeDelay({ backoffUntil: NOW - 1 }, "backoff", NOW), 0);
});

test("we only back off from answers worth retrying later", () => {
    assert.equal(Policy.describeHttpFailure(429).backoff, true);
    assert.equal(Policy.describeHttpFailure(500).backoff, true);
    assert.equal(Policy.describeHttpFailure(503).backoff, true);
    assert.equal(Policy.describeHttpFailure(418).backoff, false);
    assert.deepEqual(Policy.describeHttpFailure(418).error,
                     { code: "http", status: 418 });
});

test("a 429 is named, not left as a bare code: it is the one we expect", () => {
    assert.deepEqual(Policy.describeHttpFailure(429),
                     { error: { code: "rate-limited" }, backoff: true });
});

test("Retry-After is read as seconds, and nonsense is read as absent", () => {
    assert.equal(Policy.retryAfterSeconds("3600"), 3600);
    assert.equal(Policy.retryAfterSeconds(null), 0);
    assert.equal(Policy.retryAfterSeconds(""), 0);
    assert.equal(Policy.retryAfterSeconds("0"), 0);
    assert.equal(Policy.retryAfterSeconds("-60"), 0);
    // A date form, which the header also allows, is not seconds. Treating it as
    // absent leaves our own escalation in charge, which is the safe direction.
    assert.equal(Policy.retryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT"), 0);
    assert.equal(Policy.retryAfterSeconds(String(24 * 3600)), Policy.RETRY_AFTER_MAX);
});

test("the server's wait wins when it is longer, and never shortens ours", () => {
    // What the live endpoint actually sends with a 429: an hour, against a
    // first step of ten minutes.
    assert.equal(Policy.backoffDelay(Policy.BACKOFF_START, 3600), 3600);
    assert.equal(Policy.backoffDelay(Policy.BACKOFF_MAX, 60), Policy.BACKOFF_MAX);
    assert.equal(Policy.backoffDelay(Policy.BACKOFF_START, 0), Policy.BACKOFF_START);
    assert.equal(Policy.backoffDelay(0, 0), Policy.BACKOFF_START);
});

test("401 and 403 get names rather than codes: time does not cure them", () => {
    assert.deepEqual(Policy.describeHttpFailure(401),
                     { error: { code: "token-expired" }, backoff: false });
    assert.deepEqual(Policy.describeHttpFailure(403),
                     { error: { code: "forbidden" }, backoff: false });
});
