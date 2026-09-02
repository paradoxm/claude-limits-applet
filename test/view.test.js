const { test } = require("node:test");
const assert = require("node:assert/strict");
const View = require("../claude-limits@paradoxm/lib/view.js");
const Usage = require("../claude-limits@paradoxm/lib/usage.js");
const Strings = require("../claude-limits@paradoxm/lib/strings.js");

const NOW = Math.floor(new Date(2026, 8, 2, 12, 40, 0).getTime() / 1000);
const RESET_SESSION = NOW + 1 * 3600 + 39 * 60;
const RESET_WEEK = NOW + 19 * 3600 + 20 * 60;

const data = (sessionPercent, weeklyPercent) => ({
    session: { percent: sessionPercent, resetsAt: RESET_SESSION },
    weekly: { percent: weeklyPercent, resetsAt: RESET_WEEK }
});
const opts = (over) => Object.assign({ warn: 80, crit: 90, now: NOW, showPaceMark: true,
                                       clickToRefresh: true, t: Strings.EN }, over);

test("the colour flips exactly on the threshold, not near it", () => {
    assert.equal(View.colorFor(0, 80, 90), View.CALM);
    assert.equal(View.colorFor(79, 80, 90), View.CALM);
    assert.equal(View.colorFor(80, 80, 90), View.WATCH);
    assert.equal(View.colorFor(89, 80, 90), View.WATCH);
    assert.equal(View.colorFor(90, 80, 90), View.ALARM);
    assert.equal(View.colorFor(100, 80, 90), View.ALARM);
});

test("the red threshold can never end up below the amber one", () => {
    // Both are typed by hand in the settings and can be crossed.
    assert.equal(View.colorFor(85, 90, 50), View.CALM);
    assert.equal(View.colorFor(90, 90, 50), View.ALARM);
    assert.equal(View.colorFor(95, 90, 50), View.ALARM);
});

test("with no data the panel shows a placeholder rather than nothing", () => {
    const markup = View.panelMarkup(null, opts());
    assert.ok(markup.includes("··"));
    assert.ok(markup.startsWith(View.LEAD));
});

test("both panel numbers get their own colour", () => {
    const markup = View.panelMarkup(data(95, 8), opts());
    assert.ok(markup.includes("'" + View.ALARM.hex + "'>95<"));
    assert.ok(markup.includes("'" + View.CALM.hex + "'>8<"));
});

test("the panel markup begins with a zero-width space", () => {
    // Regression: without it a Pango attribute starting at byte zero was
    // overridden by the theme colour and the first number came out uncoloured.
    const markup = View.panelMarkup(data(71, 9), opts());
    assert.equal(markup[0], View.LEAD);
    assert.ok(markup.indexOf("<span fgcolor") > 0);
});

test("the tooltip markup begins with a zero-width space too", () => {
    assert.equal(View.tooltipMarkup({ data: data(71, 9), fetchedAt: NOW }, opts())[0], View.LEAD);
    assert.equal(View.tooltipMarkup({ data: null, error: null }, opts())[0], View.LEAD);
    assert.equal(View.tooltipMarkup({ data: null, error: { code: "http", status: 429 } },
                                    opts())[0], View.LEAD);
});

test("the tooltip bar length follows the percentage", () => {
    const cells = (percent) => {
        const block = View.limitBlock("window", { percent, resetsAt: 0 },
                                      Usage.SESSION_WINDOW, opts());
        const filled = block.slice(block.indexOf("<tt>"),
                                   block.indexOf("</span>", block.indexOf("<tt>")));
        return (filled.match(/█/g) || []).length;
    };
    assert.equal(cells(0), 0);
    assert.equal(cells(50), View.BAR_CELLS / 2);
    assert.equal(cells(100), View.BAR_CELLS);
    assert.ok(cells(1) <= 1);
});

test("the bar never spills outside its own cells", () => {
    for (const percent of [0, 1, 33, 99, 100, 120, -5]) {
        const block = View.limitBlock("window", { percent, resetsAt: 0 },
                                      Usage.SESSION_WINDOW, opts());
        assert.equal((block.match(/█/g) || []).length, View.BAR_CELLS, "percent " + percent);
    }
});

test("the absolute reset time is shown only when the reset is today", () => {
    const today = View.limitBlock("window", { percent: 50, resetsAt: RESET_SESSION },
                                  Usage.SESSION_WINDOW, opts());
    assert.match(today, /resets in 1 h 39 min, at \d\d:\d\d/);

    const tomorrow = View.limitBlock("window", { percent: 50, resetsAt: RESET_WEEK },
                                     Usage.WEEK_WINDOW, opts());
    assert.match(tomorrow, /resets in 19 h 20 min<\/span>/);
    assert.ok(!/resets in 19 h 20 min, at/.test(tomorrow));
});

test("without a reset time there is no reset line at all", () => {
    const block = View.limitBlock("window", { percent: 50, resetsAt: 0 },
                                  Usage.SESSION_WINDOW, opts());
    assert.ok(!block.includes("resets"));
    assert.ok(!block.includes("at this pace"));
});

test("the pace warning appears when spending outruns the window", () => {
    const resetsAt = NOW + Usage.SESSION_WINDOW / 2;
    const block = View.limitBlock("window", { percent: 80, resetsAt },
                                  Usage.SESSION_WINDOW, opts());
    assert.match(block, /hit the limit by \d\d:\d\d/);
    assert.ok(block.includes(View.WATCH.hex));
});

test("at a calm pace the tooltip reassures instead of alarming", () => {
    const resetsAt = NOW + Usage.SESSION_WINDOW / 2;
    const block = View.limitBlock("window", { percent: 20, resetsAt },
                                  Usage.SESSION_WINDOW, opts());
    assert.ok(block.includes("lasts until the reset"));
    assert.ok(!block.includes("hit the limit"));
});

test("at zero spending nothing is said about the pace", () => {
    const resetsAt = NOW + Usage.SESSION_WINDOW / 2;
    const block = View.limitBlock("window", { percent: 0, resetsAt },
                                  Usage.SESSION_WINDOW, opts());
    assert.ok(!block.includes("at this pace"));
});

test("the tooltip names itself, shows both windows and the update time", () => {
    const markup = View.tooltipMarkup({ data: data(71, 9), fetchedAt: NOW - 120 }, opts());
    assert.ok(markup.includes("Claude Code limits"));
    assert.ok(markup.includes("five-hour window"));
    assert.ok(markup.includes("weekly window"));
    assert.ok(markup.includes("updated 2 min ago"));
    assert.ok(markup.includes("click to refresh"));
});

test("the whole tooltip follows the chosen language", () => {
    const markup = View.tooltipMarkup({ data: data(71, 9), fetchedAt: NOW - 120 },
                                      opts({ t: Strings.RU }));
    assert.ok(markup.includes("Лимиты Claude Code"));
    assert.ok(markup.includes("пятичасовое окно"));
    assert.ok(markup.includes("обновлено 2 мин назад"));
    assert.ok(!markup.includes("five-hour"));
});

test("with no data the tooltip explains what is going on", () => {
    assert.ok(View.tooltipMarkup({ data: null, error: null }, opts()).includes("Fetching usage"));
    const failed = View.tooltipMarkup({ data: null, error: { code: "http", status: 429 } }, opts());
    assert.ok(failed.includes("Claude Code limits"));
    assert.ok(failed.includes("HTTP 429"));
});

test("error text stays English even on a Russian panel", () => {
    const markup = View.tooltipMarkup({ data: null, error: { code: "token-expired" } },
                                      opts({ t: Strings.RU }));
    assert.ok(markup.includes("Лимиты Claude Code"));
    assert.ok(markup.includes("run Claude Code"));
});

test("error text cannot break the markup it is embedded in", () => {
    const markup = View.tooltipMarkup(
        { data: null, error: { code: "exception", text: "<b>&boom</b>" } }, opts());
    assert.ok(markup.includes("&lt;b&gt;&amp;boom&lt;/b&gt;"));
});

test("the footer explains every reason for the silence", () => {
    const state = { data: data(71, 9), fetchedAt: NOW };
    const withReason = (over) => View.tooltipMarkup(Object.assign({}, state, over), opts());
    assert.match(withReason({ error: { code: "http", status: 429 } }),
                 /last attempt failed: HTTP 429/);
    assert.match(withReason({ pausedReason: "idle" }), /Claude Code is idle/);
    assert.match(withReason({ pausedReason: "off" }), /switched off in the settings/);
    assert.ok(!View.tooltipMarkup(state, opts({ clickToRefresh: false }))
                  .includes("click to refresh"));
});

test("a pause after a server refusal names the time it holds until", () => {
    // Otherwise the applet silently dims for up to an hour without saying why.
    const until = NOW + 1800;
    const markup = View.tooltipMarkup(
        { data: data(71, 9), fetchedAt: NOW, pausedReason: "backoff", backoffUntil: until }, opts());
    assert.match(markup, /polling paused until \d\d:\d\d after the server refused/);

    const noTime = View.tooltipMarkup(
        { data: data(71, 9), fetchedAt: NOW, pausedReason: "backoff" }, opts());
    assert.match(noTime, /polling paused after the server refused/);
});

test("an error outranks a pause: the breakage is reported first", () => {
    const markup = View.tooltipMarkup(
        { data: data(71, 9), fetchedAt: NOW, error: { code: "http", status: 500 },
          pausedReason: "idle" }, opts());
    assert.ok(markup.includes("HTTP 500"));
    assert.ok(!markup.includes("is idle"));
});

test("dimming switches on exactly when the footer explains why", () => {
    // These used to be two independent conditions in two different files.
    assert.equal(View.isMuted({ error: null, pausedReason: null }), false);
    assert.equal(View.isMuted({ error: { code: "http", status: 500 }, pausedReason: null }), true);
    assert.equal(View.isMuted({ error: null, pausedReason: "off" }), true);
    assert.equal(View.isMuted({ error: null, pausedReason: "idle" }), true);
    assert.equal(View.isMuted({ error: null, pausedReason: "backoff" }), true);
});

test("with no data the bars draw empty tracks only", () => {
    const layout = View.barLayout(30, null, opts());
    assert.equal(layout.columns.length, 2);
    assert.equal(layout.columns[0].rgb, undefined);
    assert.equal(layout.columns[0].fillHeight, undefined);
    assert.equal(layout.mark, null);
});

test("the bars do not overlap and fit their declared width", () => {
    const layout = View.barLayout(30, data(50, 50), opts());
    assert.equal(layout.columns[0].x, 0);
    assert.equal(layout.columns[1].x, View.BAR_WIDTH + View.BAR_GAP);
    assert.equal(layout.columns[1].x + layout.columns[1].width, View.barsWidth());
});

test("the fill grows from the bottom and stays inside the track", () => {
    const layout = View.barLayout(40, data(100, 0), opts());
    const full = layout.columns[0];
    assert.equal(full.fillTop, full.top);
    assert.equal(full.fillHeight, full.height);

    const empty = layout.columns[1];
    // Zero spending still draws one row of pixels: otherwise it is
    // indistinguishable from having no data.
    assert.equal(empty.fillHeight, 1);
    assert.equal(empty.fillTop, empty.top + empty.height - 1);
});

test("the bar takes the same colour as the number", () => {
    const layout = View.barLayout(30, data(95, 8), opts());
    assert.deepEqual(layout.columns[0].rgb, View.ALARM.rgb);
    assert.deepEqual(layout.columns[1].rgb, View.CALM.rgb);
});

test("the track does not collapse on a short panel", () => {
    assert.ok(View.barLayout(10, null, opts()).columns[0].height >= 10);
    assert.ok(View.barLayout(0, null, opts()).columns[0].height >= 10);
});

test("the pace mark sits at the elapsed share and overhangs the bar", () => {
    const halfway = NOW + Usage.SESSION_WINDOW / 2;
    const layout = View.barLayout(40, { session: { percent: 30, resetsAt: halfway },
                                        weekly: { percent: 5, resetsAt: 0 } }, opts());
    const column = layout.columns[0];
    // The mark is measured from the bottom of the track, like the fill.
    assert.equal(layout.mark.y, column.top + column.height - Math.round(column.height * 0.5));
    assert.equal(layout.mark.x, column.x - 1);
    assert.equal(layout.mark.width, View.BAR_WIDTH + 2);
});

test("the mark is absent when switched off or when the pace is unknown", () => {
    const halfway = NOW + Usage.SESSION_WINDOW / 2;
    const withPace = { session: { percent: 30, resetsAt: halfway },
                       weekly: { percent: 5, resetsAt: 0 } };
    assert.equal(View.barLayout(40, withPace, opts({ showPaceMark: false })).mark, null);
    assert.equal(View.barLayout(40, data(30, 5),
                                opts({ now: RESET_SESSION - Usage.SESSION_WINDOW })).mark, null);
});
