// Every user-facing phrase, in one place per language.
//
// The applet does not use gettext: the language is an explicit setting rather
// than a consequence of the session locale, so the same desktop can run an
// English panel next to Russian applications. Adding a language means adding
// one object here and one option to the schema.

var EN = {
    title: "Claude Code limits",
    fetching: "Fetching usage…",
    sessionWindow: "five-hour window",
    weeklyWindow: "weekly window",

    lessThanMinute: "less than a minute",
    days: "d", hours: "h", minutes: "min",
    justNow: "just now",
    ago: function(duration) { return duration + " ago"; },

    resetsIn: function(duration) { return "resets in " + duration; },
    atTime: function(clock) { return ", at " + clock; },
    exhaustedBy: function(clock) { return "at this pace you hit the limit by " + clock; },
    lastsUntilReset: "at this pace it lasts until the reset",

    updated: function(ago) { return "updated " + ago; },
    attemptFailed: function(reason) { return "last attempt failed: " + reason; },
    pausedOff: "polling is switched off in the settings",
    pausedIdle: "polling paused, Claude Code is idle",
    pausedBackoff: "polling paused after the server refused",
    pausedRateLimited: function(clock) {
        return "rate limited until " + clock + "; asking earlier restarts the hour";
    },
    pausedBackoffUntil: function(clock) {
        return "polling paused until " + clock + " after the server refused";
    },
    clickToRefresh: "click to refresh",

};

var RU = {
    title: "Лимиты Claude Code",
    fetching: "Запрашиваю расход…",
    sessionWindow: "пятичасовое окно",
    weeklyWindow: "недельное окно",

    lessThanMinute: "меньше минуты",
    days: "д", hours: "ч", minutes: "мин",
    justNow: "только что",
    ago: function(duration) { return duration + " назад"; },

    resetsIn: function(duration) { return "сброс через " + duration; },
    atTime: function(clock) { return ", в " + clock; },
    exhaustedBy: function(clock) { return "при таком темпе упрётесь в лимит к " + clock; },
    lastsUntilReset: "при таком темпе до сброса хватит",

    updated: function(ago) { return "обновлено " + ago; },
    attemptFailed: function(reason) { return "последняя попытка не удалась: " + reason; },
    pausedOff: "опрос выключен в настройках",
    pausedIdle: "опрос на паузе, Claude Code простаивает",
    pausedBackoff: "опрос приостановлен после отказа сервера",
    pausedRateLimited: function(clock) {
        return "лимит запросов до " + clock + ", запрос раньше продлит час";
    },
    pausedBackoffUntil: function(clock) {
        return "опрос приостановлен до " + clock + " после отказа сервера";
    },
    clickToRefresh: "клик обновит",

};

// Error text is English in every language: it is diagnostic output for
// whoever has to act on it, not part of the panel's voice.
var ERRORS = {
    unparsable: "the credentials file does not parse",
    "no-token": "the file has no claudeAiOauth.accessToken",
    "token-expired": "the token has expired — run Claude Code and it will refresh it",
    forbidden: "access to the endpoint is forbidden (403)",
    "rate-limited": "the endpoint is rate limiting us (429) — waiting it out"
};

var errorText = function(error) {
    if (!error) return "";
    if (ERRORS[error.code]) return ERRORS[error.code];
    if (error.code === "unreadable") return "cannot read " + error.path;
    if (error.code === "http") return "HTTP " + error.status;
    return String(error.text || error.code);
};

var LANGUAGES = { en: EN, ru: RU };

var stringsFor = function(language) {
    return LANGUAGES[language] || EN;
};

if (typeof module !== "undefined")
    module.exports = { EN, RU, ERRORS, LANGUAGES, errorText, stringsFor };
