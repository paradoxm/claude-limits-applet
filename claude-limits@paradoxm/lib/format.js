// Turning seconds and timestamps into words. Changes when the wording changes,
// and depends on nothing but the phrase table it is handed.

var formatDuration = function(seconds, t) {
    // Anything under a minute must not round down to "0 min" — that reads as
    // a malfunction rather than as a countdown.
    if (seconds < 60) return t.lessThanMinute;
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor(seconds % 86400 / 3600);
    var minutes = Math.floor(seconds % 3600 / 60);
    if (days > 0) return days + " " + t.days + " " + hours + " " + t.hours;
    if (hours > 0) return hours + " " + t.hours + " " + minutes + " " + t.minutes;
    return minutes + " " + t.minutes;
};

var formatAgo = function(seconds, t) {
    if (seconds < 90) return t.justNow;
    return t.ago(formatDuration(seconds, t));
};

var formatClock = function(unix) {
    var d = new Date(unix * 1000);
    var pad = function(n) { return n < 10 ? "0" + n : String(n); };
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
};

var isSameDay = function(unix, now) {
    var a = new Date(unix * 1000), b = new Date(now * 1000);
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
};

var escapeMarkup = function(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

if (typeof module !== "undefined")
    module.exports = { formatDuration, formatAgo, formatClock, isSameDay, escapeMarkup };
