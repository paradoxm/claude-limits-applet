// When the applet is allowed to reach api.anthropic.com. Changes when the
// thrift rules change; knows nothing about the network or about widgets.

// No request leaves sooner than this many seconds after the previous one,
// whatever the configured interval is and however often the user clicks.
var MIN_REQUEST_GAP = 30;

// Back-off after a 429 or a 5xx: doubles from ten minutes to an hour, and a
// successful answer resets it.
var BACKOFF_START = 600;
var BACKOFF_MAX = 3600;

// Claude Code counts as idle when history.jsonl has not changed for this long.
var IDLE_AFTER = 1800;

// The order of the guards is not arbitrary. The cheap ones come first, and the
// idle check comes last because it costs a blocking read from disk — there is
// no reason to pay for it on a path that leads nowhere anyway.
var fetchDecision = function(state, opts) {
    if (state.inFlight) return "in-flight";
    if (!opts.pollingEnabled && !opts.manual) return "off";
    // Our own back-off is a guess — we do not know the endpoint is still
    // refusing, so a click is allowed to go and find out. A Retry-After is not
    // a guess: the server named the time. And asking before it elapses does
    // not merely fail, it comes back with a fresh Retry-After counted from the
    // new attempt, so an impatient click keeps the hour permanently ahead of
    // itself. This is the one wait a click cannot override.
    if (opts.now < (state.serverWaitUntil || 0)) return "rate-limited";
    if (opts.now - (state.lastCallAt || 0) < MIN_REQUEST_GAP) return "too-soon";
    if (!opts.manual && opts.now < (state.backoffUntil || 0)) return "backoff";
    if (!opts.manual && opts.skipWhenIdle && state.data && opts.isClaudeIdle())
        return "idle";
    return "fetch";
};

// Of the outcomes the user only needs those that mean "polling has stopped and
// will not resume by itself within the minute". The rest pass in silence: they
// resolve by the next tick.
var PAUSED = ["off", "rate-limited", "backoff", "idle"];

var pausedReason = function(decision) {
    return PAUSED.indexOf(decision) >= 0 ? decision : null;
};

var nextBackoff = function(current) {
    return Math.min((current || BACKOFF_START) * 2, BACKOFF_MAX);
};

// The first request waits out the guard gap left by the previous call, or a
// Cinnamon restart would leave the applet blank until the next tick.
var kickDelay = function(lastCallAt, now) {
    return Math.max(4, MIN_REQUEST_GAP - (now - (lastCallAt || 0)) + 1);
};

// A few seconds past the moment the wall lifts, so a clock skew of one second
// does not spend the attempt on a refusal that renews the whole hour.
var RESUME_MARGIN = 5;

// A pause with a known end deserves a request at that end rather than at
// whatever moment the interval next happens to land on. An hour-long rate
// limit against a ten-minute interval would otherwise keep the panel blank for
// up to ten minutes after the endpoint had started answering again.
var resumeDelay = function(state, decision, now) {
    var until = decision === "rate-limited" ? state.serverWaitUntil
              : decision === "backoff" ? state.backoffUntil
              : 0;
    return (until && until > now) ? until - now + RESUME_MARGIN : 0;
};

// Backing off only helps where retrying later can help. A refused token or a
// forbidden endpoint is not cured by time, so it gets a name and no back-off.
var describeHttpFailure = function(status) {
    if (status === 401) return { error: { code: "token-expired" }, backoff: false };
    if (status === 403) return { error: { code: "forbidden" }, backoff: false };
    if (status === 429) return { error: { code: "rate-limited" }, backoff: true };
    return { error: { code: "http", status: status }, backoff: status >= 500 };
};

// The usage endpoint answers a 429 with Retry-After: 3600 — six times our own
// first step. Coming back before the server said so is how a rate limit turns
// into a ban, so the header wins whenever it asks for longer than we planned.
// An absurd value is still capped: a header cannot park the applet for a day.
var RETRY_AFTER_MAX = 6 * 3600;

var retryAfterSeconds = function(header) {
    var seconds = parseInt(header, 10);
    if (!(seconds > 0)) return 0;
    return Math.min(seconds, RETRY_AFTER_MAX);
};

var backoffDelay = function(step, retryAfter) {
    return Math.max(step || BACKOFF_START, retryAfter || 0);
};

if (typeof module !== "undefined")
    module.exports = { MIN_REQUEST_GAP, BACKOFF_START, BACKOFF_MAX, IDLE_AFTER,
                       RETRY_AFTER_MAX, RESUME_MARGIN, fetchDecision, pausedReason,
                       nextBackoff, kickDelay, resumeDelay, describeHttpFailure,
                       retryAfterSeconds, backoffDelay };
