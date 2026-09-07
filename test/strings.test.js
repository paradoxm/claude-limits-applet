const { test } = require("node:test");
const assert = require("node:assert/strict");
const Strings = require("../claude-limits@paradoxm/lib/strings.js");

test("every language carries exactly the same keys of the same kind", () => {
    // A missing key would render as "undefined" in the panel, and a phrase
    // that lost its argument would silently drop the time it was meant to show.
    const reference = Object.keys(Strings.EN).sort();
    for (const [name, table] of Object.entries(Strings.LANGUAGES)) {
        assert.deepEqual(Object.keys(table).sort(), reference, name + " keys");
        for (const key of reference)
            assert.equal(typeof table[key], typeof Strings.EN[key], name + "." + key);
        for (const key of reference)
            if (typeof Strings.EN[key] === "function")
                assert.equal(table[key].length, Strings.EN[key].length, name + "." + key + " arity");
    }
});

test("no phrase is left untranslated by accident", () => {
    const cyrillic = /[а-яА-ЯёЁ]/;
    for (const key of Object.keys(Strings.RU)) {
        const value = typeof Strings.RU[key] === "function" ? Strings.RU[key]("X") : Strings.RU[key];
        if (/^[\d\s:%.]*$/.test(String(value).replace(/X/g, ""))) continue;
        assert.ok(cyrillic.test(String(value)), "ru." + key + " is still English: " + value);
    }
});

test("an unknown language falls back to English rather than breaking", () => {
    assert.equal(Strings.stringsFor("en"), Strings.EN);
    assert.equal(Strings.stringsFor("ru"), Strings.RU);
    assert.equal(Strings.stringsFor("kl"), Strings.EN);
    assert.equal(Strings.stringsFor(undefined), Strings.EN);
    assert.equal(Strings.stringsFor(null), Strings.EN);
});

test("error text is one English set, whatever the panel language", () => {
    assert.equal(Strings.errorText({ code: "token-expired" }),
                 Strings.ERRORS["token-expired"]);
    assert.match(Strings.errorText({ code: "token-expired" }), /run Claude Code/);
    assert.equal(Strings.errorText({ code: "forbidden" }), Strings.ERRORS.forbidden);
    assert.equal(Strings.errorText({ code: "unparsable" }), Strings.ERRORS.unparsable);
    assert.equal(Strings.errorText({ code: "no-token" }), Strings.ERRORS["no-token"]);
    assert.equal(Strings.errorText({ code: "rate-limited" }),
                 Strings.ERRORS["rate-limited"]);
});

test("error text keeps the detail that makes a failure actionable", () => {
    assert.equal(Strings.errorText({ code: "http", status: 429 }), "HTTP 429");
    assert.equal(Strings.errorText({ code: "unreadable", path: "/tmp/x.json" }),
                 "cannot read /tmp/x.json");
    assert.equal(Strings.errorText({ code: "exception", text: "JSON.parse failed" }),
                 "JSON.parse failed");
});

test("errorText never returns undefined, whatever it is handed", () => {
    assert.equal(Strings.errorText(null), "");
    assert.equal(Strings.errorText(undefined), "");
    assert.equal(Strings.errorText({ code: "something-new" }), "something-new");
});
