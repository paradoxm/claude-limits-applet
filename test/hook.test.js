const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const HOOK = path.join(__dirname, "..", "claude-limits@paradoxm", "claude-code-hook.sh");
const now = () => Math.floor(Date.now() / 1000);
let home, dir;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "hook-"));
    dir = path.join(home, ".claude", "limit-watch");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "status.json"), "{}");
});

const run = (payload, event = "PostToolUse") => {
    const result = spawnSync("bash", [HOOK, event], { input: JSON.stringify(payload), encoding: "utf8",
                                                     env: Object.assign({}, process.env, { HOME: home }) });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout ? JSON.parse(result.stdout) : null;
};
const over = (key = "over:weekly:1", until = now() + 3600) =>
    fs.writeFileSync(path.join(dir, "alert.json"), JSON.stringify({ key, until, text: "t", notice: "n" }));
const allow = (sid = "s") => run({ session_id: sid, prompt: "Можно за деньги, продолжай" }, "UserPromptSubmit");

test("without an alert the hook says nothing: no tokens", () => {
    assert.equal(run({ session_id: "s" }), null);
});

test("over the limit nothing runs until the human allows it", () => {
    over();
    assert.equal(run({ session_id: "s", prompt: "делай" }, "UserPromptSubmit").decision, "block");
    assert.equal(run({ session_id: "s" }).continue, false);
    assert.equal(run({ session_id: "s", agent_id: "a" }).continue, false);
    const started = run({ session_id: "s", source: "startup" }, "SessionStart");
    assert.deepEqual(Object.keys(started), ["systemMessage"]);   // to the human, not into Claude's context
    assert.match(started.systemMessage, /можно за деньги/);
});

test("after the permission the whole session works in silence", () => {
    over();
    assert.equal(allow(), null);
    assert.equal(run({ session_id: "s" }), null);
    assert.equal(run({ session_id: "s", agent_id: "a" }), null);
    assert.equal(run({ session_id: "s", source: "compact" }, "SessionStart"), null);
});

test("the permission survives a switch of the binding window", () => {
    over();
    allow();
    over("over:session:7", now() + 600);
    assert.equal(run({ session_id: "s" }), null);
});

test("the permission ends with the reset, another session and a restart", () => {
    over();
    allow();
    assert.equal(run({ session_id: "other" }).continue, false);
    fs.writeFileSync(path.join(dir, "allowed", "s"), String(now() - 1));
    assert.equal(run({ session_id: "s" }).continue, false);
    allow();
    run({ session_id: "s", source: "resume" }, "SessionStart");
    assert.equal(run({ session_id: "s" }).continue, false);
});

test("without a session_id there is no permission", () => {
    over();
    assert.equal(run({ prompt: "можно за деньги" }, "UserPromptSubmit").decision, "block");
    assert.equal(fs.existsSync(path.join(dir, "allowed")), false);
});

test("an alert whose reset has passed no longer stops anyone", () => {
    // The applet may not have ticked since the reset — after a suspend, say
    over("over:weekly:1", now() - 1);
    assert.equal(run({ session_id: "s", prompt: "x" }, "UserPromptSubmit"), null);
});

test("without jq an exhausted limit stops rather than passes", () => {
    over();
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "bin-"));
    for (const tool of ["cat", "date", "stat", "rm"])
        fs.symlinkSync(execFileSync("which", [tool], { encoding: "utf8" }).trim(), path.join(bare, tool));
    const result = spawnSync("/bin/bash", [HOOK, "PostToolUse"], { input: "{}",
                                                                 env: { HOME: home, PATH: bare } });
    assert.equal(result.status, 2);
});

test("a warning is said once, and only to the main agent", () => {
    fs.writeFileSync(path.join(dir, "alert.json"), JSON.stringify({ key: "blind:http", text: "t", notice: "n" }));
    assert.equal(run({ session_id: "s", agent_id: "a" }), null);
    const said = run({ session_id: "s" });
    assert.equal(said.systemMessage, "n");
    assert.equal(said.hookSpecificOutput.additionalContext, "t");
    assert.equal(run({ session_id: "s" }), null);
});

test("a dead applet is noticed, a slow interval is not", () => {
    const status = path.join(dir, "status.json");
    const age = (seconds) => fs.utimesSync(status, now() - seconds, now() - seconds);
    fs.writeFileSync(status, JSON.stringify({ stale_after: 10800 }));
    age(4000);
    assert.equal(run({ session_id: "s" }), null);
    age(11000);
    assert.match(run({ session_id: "s" }).systemMessage, /апплет/);
});
