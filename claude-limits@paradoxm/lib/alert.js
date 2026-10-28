// What Claude Code is told about the limits. The applet writes two files that a
// Claude Code hook reads: status.json on every tick, and alert.json only while
// a window is past the threshold — the hook stops Claude while it exists.
// Changes when the rules of that stop change; knows nothing about files.

var sibling = function(name) {
    return (typeof require !== "undefined")
        ? require("./" + name + ".js")
        : imports.ui.appletManager.applets["claude-limits@paradoxm"].lib[name];
};

var Usage = sibling("usage");

var WINDOWS = ["session", "weekly", "weekly_model"];

// Figures older than this, with the last request failing, mean the limits are
// not visible; Claude is told so, but not stopped.
var BLIND_AFTER = 1800;

// An expired token is the normal state while Claude Code is closed — the first
// session renews it — so it does not count as blindness.
var QUIET_ERRORS = ["token-expired"];

// Unlike parseUsage, a missing percent stays unknown rather than 0: a 0 would
// read as "free" and let the work through exactly when the response changed.
var percentOf = function(source) {
    if (!source) return null;
    var raw = (source.percent !== undefined && source.percent !== null)
        ? source.percent : source.utilization;
    if (raw === undefined || raw === null || isNaN(Number(raw))) return null;
    return Math.round(Number(raw));
};

// The three windows. weekly_model is the most spent of the per-model weekly
// windows: on the expensive model it is usually the one that runs out first.
// A window whose reset has passed is unknown: an old answer kept through a 429
// must not hold the stop past the reset.
var windowsOf = function(json, now) {
    var list = (json && Array.isArray(json.limits))
        ? json.limits.filter(function(item) { return item && typeof item === "object"; }) : [];
    var byKind = function(kind) {
        for (var i = 0; i < list.length; i++) if (list[i].kind === kind) return list[i];
        return null;
    };
    var scoped = null;
    list.forEach(function(item) {
        if (item.kind === "weekly_scoped"
            && (scoped === null || (percentOf(item) || 0) > (percentOf(scoped) || 0)))
            scoped = item;
    });
    var take = function(source) {
        var resetsAt = Usage.parseIso8601(source && source.resets_at);
        var percent = percentOf(source);
        return { percent: resetsAt && resetsAt < now ? null : percent, resetsAt: resetsAt };
    };
    return {
        session: take(byKind("session") || (json && json.five_hour)),
        weekly: take(byKind("weekly_all") || (json && json.seven_day)),
        weekly_model: take(scoped)
    };
};

var pad = function(n) { return n < 10 ? "0" + n : String(n); };

var dayAndClock = function(unix) {
    var d = new Date(unix * 1000);
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + " "
        + pad(d.getHours()) + ":" + pad(d.getMinutes());
};

// state is the applet's own: data as received (raw), fetchedAt, error.
var report = function(raw, state, threshold, now) {
    var windows = windowsOf(raw, now);
    var binding = null;
    WINDOWS.forEach(function(name) {
        var w = windows[name];
        if (w.percent === null) return;
        // On a tie the later reset binds: it holds the stop longer
        if (binding === null || w.percent > windows[binding].percent
            || (w.percent === windows[binding].percent && w.resetsAt > windows[binding].resetsAt))
            binding = name;
    });
    var status = {
        written_at: now,
        fetched_at: state.fetchedAt || null,
        threshold: threshold,
        binding_window: binding,
        over_threshold: binding === null ? null : windows[binding].percent >= threshold,
        paid_overflow: !!(raw && raw.extra_usage && raw.extra_usage.is_enabled),
        error: state.error ? state.error.code : null
    };
    WINDOWS.forEach(function(name) {
        var w = windows[name];
        status[name + "_percent"] = w.percent;
        status[name + "_resets_at"] = w.resetsAt || null;
        status[name + "_minutes_to_reset"] = w.resetsAt ? Math.max(0, Math.round((w.resetsAt - now) / 60)) : null;
    });
    return { status: status, alert: alertFor(status, now) };
};

var alertFor = function(status, now) {
    var name = status.binding_window;
    if (status.over_threshold) {
        var resetsAt = status[name + "_resets_at"];
        // Without a reset time the permission to pay lives an hour, then the human is asked again
        var until = resetsAt || now + 3600;
        var percent = status[name + "_percent"];
        var when = resetsAt ? dayAndClock(resetsAt) : "неизвестно когда";
        var text = "limit-watch: окно `" + name + "` израсходовано на " + percent + "% (порог "
            + status.threshold + "%), сброс " + when + ".";
        var notice = "⛔ Лимит Claude исчерпан: окно " + name + " — " + percent + "%, сброс " + when;
        if (status.paid_overflow) {
            text += " Включён `paid_overflow`: дальше работа идёт за деньги, решает человек.";
            notice += ". Дальше — за деньги";
        }
        // The hour, not the exact time: the server shifts the reset by fractions of a second
        return { key: "over:" + name + ":" + Math.round(until / 3600), until: until,
                 text: text, notice: notice };
    }
    var age = status.fetched_at ? now - status.fetched_at : Infinity;
    if (status.error && QUIET_ERRORS.indexOf(status.error) < 0
        && (status.over_threshold === null || age > BLIND_AFTER)) {
        var minutes = age === Infinity ? "давно" : Math.round(age / 60) + " мин";
        return { key: "blind:" + status.error,
                 text: "limit-watch: расход не виден (" + minutes + ", " + status.error
                     + "). Не начинай крупного, скажи человеку.",
                 notice: "⚠ Расход Claude не виден: " + status.error };
    }
    return null;
};

if (typeof module !== "undefined")
    module.exports = { WINDOWS, BLIND_AFTER, windowsOf, report, alertFor, dayAndClock };
