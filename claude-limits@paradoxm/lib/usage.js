// The shape of the api.anthropic.com/api/oauth/usage response and everything
// derived from it. Changes when Anthropic changes that shape.
//
// The module never reads the clock: the current time always arrives as an
// argument, which is what makes its behaviour reproducible in tests.

var SESSION_WINDOW = 5 * 3600;
var WEEK_WINDOW = 7 * 24 * 3600;

// A forecast is only made once this much of the window has elapsed. Earlier
// than that the sample is too small and the extrapolation lies.
var PACE_MIN_ELAPSED = 0.05;

var parseIso8601 = function(text) {
    if (!text) return 0;
    var ms = Date.parse(text);
    return isNaN(ms) ? 0 : Math.floor(ms / 1000);
};

// The response carries both a limits array and the older five_hour/seven_day
// fields. Read the array, keep the older fields as the fallback.
var parseUsage = function(json) {
    var byKind = function(kind) {
        var list = json && json.limits;
        if (!Array.isArray(list)) return null;
        for (var i = 0; i < list.length; i++)
            if (list[i] && list[i].kind === kind) return list[i];
        return null;
    };
    var take = function(kind, legacy) {
        var source = byKind(kind) || legacy || null;
        var raw = 0;
        if (source)
            raw = (source.percent !== undefined && source.percent !== null)
                ? source.percent : source.utilization;
        return {
            percent: Math.round(Number(raw) || 0),
            resetsAt: parseIso8601(source && source.resets_at)
        };
    };
    return {
        session: take("session", json && json.five_hour),
        weekly: take("weekly_all", json && json.seven_day)
    };
};

// The last answer of the previous session, read back from the settings. It is
// re-parsed rather than trusted: it may have been written by an older version,
// or by a shape Anthropic has since changed. parseUsage answers for any object
// at all — a shape it no longer understands comes back as a confident 0% — so
// a reset time is what tells a real answer from a husk. It is the one field
// that cannot be invented from nothing.
var restoreUsage = function(text) {
    if (!text) return null;
    var data;
    try {
        data = parseUsage(JSON.parse(text));
    } catch (e) {
        return null;
    }
    return (data.session.resetsAt || data.weekly.resetsAt) ? data : null;
};

// The window is restored whole at the reset, so spending can be compared
// against the share of time already gone. exhaustsAt is zero when the current
// pace lasts until the reset.
var pace = function(limit, window, now) {
    if (!limit || !limit.resetsAt) return null;
    var elapsed = window - (limit.resetsAt - now);
    if (elapsed < window * PACE_MIN_ELAPSED || elapsed > window) return null;
    var fraction = elapsed / window;
    if (limit.percent <= 0) return { fraction: fraction, exhaustsAt: 0 };
    var exhaustsAt = now + (100 - limit.percent) * (elapsed / limit.percent);
    return {
        fraction: fraction,
        exhaustsAt: exhaustsAt > limit.resetsAt ? 0 : Math.round(exhaustsAt)
    };
};

if (typeof module !== "undefined")
    module.exports = { SESSION_WINDOW, WEEK_WINDOW, PACE_MIN_ELAPSED,
                       parseIso8601, parseUsage, restoreUsage, pace };
