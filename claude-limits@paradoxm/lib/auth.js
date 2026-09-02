// Reading the credentials Claude Code keeps for itself. Changes when Claude
// Code changes their format. The file is only ever read.
//
// Failures come back as codes, not sentences: one module decides what went
// wrong, another decides how to say it, in whichever language is configured.

// Refreshing the token here is deliberately not done: the refresh token
// rotates, so renewing it from the applet would break the sign-in inside
// Claude Code itself. An expired token is therefore an error, not a cue.
var readCredentials = function(text, nowMs) {
    var oauth;
    try {
        oauth = JSON.parse(text).claudeAiOauth;
    } catch (e) {
        return { error: { code: "unparsable" } };
    }
    if (!oauth || !oauth.accessToken)
        return { error: { code: "no-token" } };
    if (oauth.expiresAt && oauth.expiresAt <= nowMs)
        return { error: { code: "token-expired" } };
    return { token: String(oauth.accessToken).trim() };
};

// The same User-Agent Claude Code itself sends. Without it the endpoint drops
// the request into a harshly limited bucket and answers 429 forever
// (anthropics/claude-code#31021).
var userAgentFor = function(symlinkTarget) {
    var version = "2.1.0";
    var base = symlinkTarget ? String(symlinkTarget).split("/").pop() : "";
    if (/^\d+\.\d+\.\d+$/.test(base)) version = base;
    return "claude-cli/" + version + " (external, cli)";
};

if (typeof module !== "undefined")
    module.exports = { readCredentials, userAgentFor };
