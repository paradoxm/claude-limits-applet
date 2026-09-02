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

test("an expired token is an error, not a cue to refresh", () => {
    // Rotating the refresh token from the applet would break the sign-in
    // inside Claude Code itself.
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
