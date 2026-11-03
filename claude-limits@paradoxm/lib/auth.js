// Reading the credentials Claude Code keeps for itself, and renewing the token
// in them when it has expired. Changes when Claude Code changes their format or
// the way it refreshes.
//
// Failures come back as codes, not sentences: one module decides what went
// wrong, another decides how to say it, in whichever language is configured.

// The same endpoint and client Claude Code refreshes with.
var TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
var CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

// The refresh token rotates, so Claude Code and the applet must never refresh
// at once: whoever refreshes second posts a token the server already burnt and
// loses the sign-in. Both therefore take the same pair of mkdir locks Claude
// Code takes (proper-lockfile): <claude dir>/.oauth_refresh.lock, then the
// legacy <claude dir>.lock. Claude Code holds them up to a minute and keeps the
// mtime fresh every 5 s; one older than this is left over from a crash.
var LOCK_STALE_MS = 60000;

var lockPaths = function(claudeDir) {
    return [claudeDir + "/.oauth_refresh.lock", claudeDir + ".lock"];
};

var lockIsStale = function(mtimeMs, nowMs) {
    return nowMs - mtimeMs > LOCK_STALE_MS;
};

var oauthOf = function(text) {
    try {
        return JSON.parse(text).claudeAiOauth || null;
    } catch (e) {
        return undefined;
    }
};

var readCredentials = function(text, nowMs) {
    var oauth = oauthOf(text);
    if (oauth === undefined)
        return { error: { code: "unparsable" } };
    if (!oauth || !oauth.accessToken)
        return { error: { code: "no-token" } };
    if (oauth.expiresAt && oauth.expiresAt <= nowMs)
        return { error: { code: "token-expired" } };
    return { token: String(oauth.accessToken).trim() };
};

// The body of the refresh request, or null when there is nothing to refresh:
// the token is still good (someone refreshed it meanwhile), or there is no
// refresh token, or it is one the server has already refused.
var refreshBody = function(text, nowMs, deadToken) {
    var oauth = oauthOf(text);
    if (!oauth || !oauth.refreshToken || oauth.refreshToken === deadToken) return null;
    if (!(oauth.expiresAt && oauth.expiresAt <= nowMs)) return null;
    var body = { grant_type: "refresh_token", refresh_token: oauth.refreshToken,
                 client_id: oauth.clientId || CLIENT_ID };
    if (Array.isArray(oauth.scopes) && oauth.scopes.length) body.scope = oauth.scopes.join(" ");
    return body;
};

// The file with the new tokens put in, everything else untouched. Null when the
// file no longer holds the refresh token that was posted — Claude Code got
// there first, and its tokens must win (the same check Claude Code makes).
var applyRefresh = function(text, postedRefreshToken, response, nowMs) {
    var json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        return null;
    }
    var oauth = json && json.claudeAiOauth;
    if (!oauth || oauth.refreshToken !== postedRefreshToken) return null;
    if (!response || !response.access_token || !(response.expires_in > 0)) return null;
    oauth.accessToken = response.access_token;
    oauth.refreshToken = response.refresh_token || postedRefreshToken;
    oauth.expiresAt = nowMs + response.expires_in * 1000;
    if (response.refresh_token_expires_in > 0)
        oauth.refreshTokenExpiresAt = nowMs + response.refresh_token_expires_in * 1000;
    if (typeof response.scope === "string" && response.scope.trim())
        oauth.scopes = response.scope.trim().split(/\s+/);
    return JSON.stringify(json);
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
    module.exports = { TOKEN_URL, LOCK_STALE_MS, readCredentials, refreshBody, applyRefresh,
                       lockPaths, lockIsStale, userAgentFor };
