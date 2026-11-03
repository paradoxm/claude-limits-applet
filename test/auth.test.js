const { test } = require("node:test");
const assert = require("node:assert/strict");
const Auth = require("../claude-limits@paradoxm/lib/auth.js");
const { CREDENTIALS } = require("./fixtures.js");

const BEFORE_EXPIRY = 1788350793925 - 1000;

test("reads the token out of the Claude Code file and trims it", () => {
    const result = Auth.readCredentials(CREDENTIALS, BEFORE_EXPIRY);
    assert.equal(result.token, "sk-ant-oat01-example");
    assert.equal(result.error, undefined);
});

test("an expired token is an error until it is refreshed", () => {
    const result = Auth.readCredentials(CREDENTIALS, 1788350793925);
    assert.deepEqual(result.error, { code: "token-expired" });
    assert.equal(result.token, undefined);
});

test("a token without an expiry is accepted", () => {
    const text = JSON.stringify({ claudeAiOauth: { accessToken: "abc" } });
    assert.equal(Auth.readCredentials(text, Date.now()).token, "abc");
});

test("a broken or foreign file yields a code, not an exception", () => {
    assert.deepEqual(Auth.readCredentials("not json", 0).error, { code: "unparsable" });
    assert.deepEqual(Auth.readCredentials("{}", 0).error, { code: "no-token" });
    assert.deepEqual(Auth.readCredentials('{"claudeAiOauth":{}}', 0).error, { code: "no-token" });
    assert.deepEqual(Auth.readCredentials('{"mcpOAuth":[]}', 0).error, { code: "no-token" });
});

test("the User-Agent takes its version from the Claude Code install path", () => {
    assert.equal(Auth.userAgentFor("/home/user/.local/share/claude/versions/2.1.258"),
                 "claude-cli/2.1.258 (external, cli)");
});

test("the User-Agent stays well-formed when the version cannot be read", () => {
    // Without this header the endpoint answers 429 forever
    // (anthropics/claude-code#31021), so the fallback has to be valid.
    const shape = /^claude-cli\/\d+\.\d+\.\d+ \(external, cli\)$/;
    assert.match(Auth.userAgentFor(null), shape);
    assert.match(Auth.userAgentFor("/usr/bin/claude"), shape);
    assert.match(Auth.userAgentFor(""), shape);
    assert.match(Auth.userAgentFor("/opt/claude/2.1"), shape);
});

const EXPIRED = 1788350793925;

test("an expired token with a refresh token yields the refresh body", () => {
    assert.deepEqual(Auth.refreshBody(CREDENTIALS, EXPIRED), {
        grant_type: "refresh_token", refresh_token: "sk-ant-ort01-example",
        client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
    });
    const scoped = JSON.stringify({ claudeAiOauth: { refreshToken: "r", expiresAt: 1,
                                                     scopes: ["user:inference", "user:profile"],
                                                     clientId: "other" } });
    assert.deepEqual(Auth.refreshBody(scoped, 2),
                     { grant_type: "refresh_token", refresh_token: "r", client_id: "other",
                       scope: "user:inference user:profile" });
});

test("nothing is refreshed while the token is good, or with a dead or missing refresh token", () => {
    // Good again means Claude Code refreshed it while we waited for the lock
    assert.equal(Auth.refreshBody(CREDENTIALS, BEFORE_EXPIRY), null);
    assert.equal(Auth.refreshBody(CREDENTIALS, EXPIRED, "sk-ant-ort01-example"), null);
    assert.equal(Auth.refreshBody('{"claudeAiOauth":{"accessToken":"a","expiresAt":1}}', 2), null);
    assert.equal(Auth.refreshBody("not json", 2), null);
    assert.equal(Auth.refreshBody("{}", 2), null);
});

test("the new tokens go into the file and everything else stays", () => {
    const file = JSON.stringify({ mcpOAuth: { x: 1 }, claudeAiOauth: JSON.parse(CREDENTIALS).claudeAiOauth });
    const out = JSON.parse(Auth.applyRefresh(file, "sk-ant-ort01-example",
        { access_token: "new-a", refresh_token: "new-r", expires_in: 3600,
          refresh_token_expires_in: 100, scope: "user:inference user:profile" }, 1000));
    assert.deepEqual(out.mcpOAuth, { x: 1 });
    assert.deepEqual(out.claudeAiOauth, {
        accessToken: "new-a", refreshToken: "new-r", expiresAt: 1000 + 3600000,
        refreshTokenExpiresAt: 1000 + 100000, subscriptionType: "team",
        scopes: ["user:inference", "user:profile"]
    });
    // A response without a new refresh token keeps the posted one
    const kept = JSON.parse(Auth.applyRefresh(CREDENTIALS, "sk-ant-ort01-example",
        { access_token: "a2", expires_in: 10 }, 0));
    assert.equal(kept.claudeAiOauth.refreshToken, "sk-ant-ort01-example");
    assert.equal(kept.claudeAiOauth.expiresAt, 10000);
});

test("a token Claude Code rotated meanwhile is never overwritten", () => {
    assert.equal(Auth.applyRefresh(CREDENTIALS, "an-older-refresh-token",
                                   { access_token: "a", expires_in: 10 }, 0), null);
});

test("a malformed refresh answer or file writes nothing", () => {
    const r = "sk-ant-ort01-example";
    assert.equal(Auth.applyRefresh(CREDENTIALS, r, {}, 0), null);
    assert.equal(Auth.applyRefresh(CREDENTIALS, r, { access_token: "a" }, 0), null);
    assert.equal(Auth.applyRefresh(CREDENTIALS, r, null, 0), null);
    assert.equal(Auth.applyRefresh("not json", r, { access_token: "a", expires_in: 1 }, 0), null);
    assert.equal(Auth.applyRefresh("{}", r, { access_token: "a", expires_in: 1 }, 0), null);
});

test("the locks are the ones Claude Code takes, and only a crashed one is stale", () => {
    assert.deepEqual(Auth.lockPaths("/home/u/.claude"),
                     ["/home/u/.claude/.oauth_refresh.lock", "/home/u/.claude.lock"]);
    assert.equal(Auth.lockIsStale(0, Auth.LOCK_STALE_MS), false);
    assert.equal(Auth.lockIsStale(0, Auth.LOCK_STALE_MS + 1), true);
});
