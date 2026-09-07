// Everything the eye sees: palette, colour thresholds, Pango markup and bar
// geometry. Changes when the design changes. The drawing itself stays in
// applet.js — this file holds only arithmetic and strings, so both are tested.

// The same file is loaded twice: by the applet importer under Cinnamon, and
// through require under node. Cinnamon's own require will not do here, as it
// resolves paths against the xlet root rather than the module's directory.
var sibling = function(name) {
    return (typeof require !== "undefined")
        ? require("./" + name + ".js")
        : imports.ui.appletManager.applets["claude-limits@paradoxm"].lib[name];
};

var Usage = sibling("usage");
var Format = sibling("format");
var Strings = sibling("strings");

// An instrument palette rather than a traffic light: the green is muted so it
// does not pull the eye when there is nothing to look at.
var CALM  = { hex: "#6FAE8A", rgb: [0.435, 0.682, 0.541] };
var WATCH = { hex: "#E0A85C", rgb: [0.878, 0.659, 0.361] };
var ALARM = { hex: "#D95F5F", rgb: [0.851, 0.373, 0.373] };

var BAR_CELLS = 28;
var BAR_WIDTH = 5;
var BAR_GAP = 3;

// The leading zero-width space is required: a Pango attribute that starts at
// byte zero of the string is overridden by the theme colour in an St.Label,
// which would leave the first number uncoloured.
var LEAD = "​";

// The alarm threshold can never end up below the warning one, however the two
// spin buttons are set.
var colorFor = function(percent, warn, crit) {
    var alarmAt = Math.max(crit, warn);
    if (percent >= alarmAt) return ALARM;
    if (percent >= warn) return WATCH;
    return CALM;
};

// Dimming the indicator and explaining it in the footer must switch on the
// same condition, or the applet fades without saying why.
var isMuted = function(state) {
    return !!(state.error || state.pausedReason);
};

var pauseText = function(state, t) {
    if (state.pausedReason === "off") return t.pausedOff;
    if (state.pausedReason === "idle") return t.pausedIdle;
    if (state.pausedReason === "rate-limited")
        return t.pausedRateLimited(Format.formatClock(state.serverWaitUntil));
    return state.backoffUntil
        ? t.pausedBackoffUntil(Format.formatClock(state.backoffUntil))
        : t.pausedBackoff;
};

var panelMarkup = function(data, opts) {
    if (!data) return LEAD + "<span alpha='55%'>··</span>";
    return LEAD
        + "<span fgcolor='" + colorFor(data.session.percent, opts.warn, opts.crit).hex + "'>"
        + data.session.percent + "</span>"
        + "<span alpha='40%'>/</span>"
        + "<span fgcolor='" + colorFor(data.weekly.percent, opts.warn, opts.crit).hex + "'>"
        + data.weekly.percent + "</span>";
};

// The pace mark is a whole cell of the bar recoloured in the card's own ink,
// not a narrower glyph: a partial block such as ▏ draws only at the edge of
// its cell and leaves the remaining seven eighths empty, punching a visible
// hole through the bar.
var PACE_MARK_SPAN = "alpha='85%'";

// The cell the pace mark falls on, or -1 for no mark. Clamped inside the bar:
// a mark past the last cell would simply vanish.
var paceCell = function(fraction) {
    return Math.min(BAR_CELLS - 1, Math.max(0, Math.round(fraction * BAR_CELLS)));
};

// Cells of one colour are emitted as one span, so the markup stays short even
// though every cell is decided on its own.
var barMarkup = function(percent, hex, markCell) {
    var filled = Math.min(BAR_CELLS, Math.max(0, Math.round(percent / 100 * BAR_CELLS)));
    var out = "";
    var run = null;
    var flush = function() {
        if (run) out += "<span " + run.span + ">" + run.text + "</span>";
        run = null;
    };

    for (var i = 0; i < BAR_CELLS; i++) {
        var span = (i === markCell) ? PACE_MARK_SPAN
                 : (i < filled ? "fgcolor='" + hex + "'" : "alpha='28%'");
        if (run && run.span === span) run.text += "█";
        else { flush(); run = { span: span, text: "█" }; }
    }
    flush();
    return "<tt>" + out + "</tt>";
};

var limitBlock = function(title, limit, window, opts) {
    var t = opts.t;
    var hex = colorFor(limit.percent, opts.warn, opts.crit).hex;
    var p = Usage.pace(limit, window, opts.now);

    // The same reference the panel bar carries, at a size the eye can read:
    // fill past the mark means spending is ahead of the window's recovery.
    var markCell = (p && opts.showPaceMark) ? paceCell(p.fraction) : -1;

    // The number leads and the label follows, quieter: the data matters more
    // than its name.
    var lines = [
        "<span fgcolor='" + hex + "'><b><big>" + limit.percent + "%</big></b></span>"
            + "   <span alpha='60%'>" + title + "</span>",
        barMarkup(limit.percent, hex, markCell)
    ];

    if (limit.resetsAt) {
        var when = t.resetsIn(Format.formatDuration(limit.resetsAt - opts.now, t));
        if (Format.isSameDay(limit.resetsAt, opts.now))
            when += t.atTime(Format.formatClock(limit.resetsAt));
        lines.push("<span alpha='60%'>" + when + "</span>");
    }

    if (p && p.exhaustsAt)
        lines.push("<span fgcolor='" + WATCH.hex + "'>"
                   + t.exhaustedBy(Format.formatClock(p.exhaustsAt)) + "</span>");
    else if (p && limit.percent > 0)
        lines.push("<span alpha='60%'>" + t.lastsUntilReset + "</span>");

    return lines.join("\n");
};

// Deliberately quiet: the title identifies the panel, it does not compete with
// the numbers.
var titleMarkup = function(t) {
    return "<span alpha='50%'>" + t.title + "</span>";
};

var tooltipMarkup = function(state, opts) {
    var t = opts.t;
    if (!state.data)
        return LEAD + titleMarkup(t) + "\n<span alpha='65%'>"
            + (state.error
                ? Format.escapeMarkup(Strings.errorText(state.error))
                : t.fetching)
            + "</span>";

    var parts = [
        titleMarkup(t),
        limitBlock(t.sessionWindow, state.data.session, Usage.SESSION_WINDOW, opts),
        limitBlock(t.weeklyWindow, state.data.weekly, Usage.WEEK_WINDOW, opts)
    ];

    var footer = t.updated(Format.formatAgo(opts.now - state.fetchedAt, t));
    if (state.error)
        footer += ", " + t.attemptFailed(Format.escapeMarkup(Strings.errorText(state.error)));
    else if (state.pausedReason)
        footer += ", " + pauseText(state, t);
    if (opts.clickToRefresh)
        footer += "\n" + t.clickToRefresh;
    parts.push("<span alpha='45%'>" + footer + "</span>");

    return LEAD + parts.join("\n\n");
};

// The bar rectangles in drawing-area coordinates, kept out of cairo.
var barLayout = function(height, data, opts) {
    var barHeight = Math.max(10, Math.round(height * 0.62));
    var top = Math.round((height - barHeight) / 2);
    var sources = data ? [data.session, data.weekly] : [null, null];
    var columns = [];

    for (var i = 0; i < sources.length; i++) {
        var column = { x: i * (BAR_WIDTH + BAR_GAP), width: BAR_WIDTH,
                       top: top, height: barHeight };
        if (sources[i]) {
            // A completely empty column is indistinguishable from no data at
            // all, so even zero spending draws one row of pixels.
            var filled = Math.max(1, Math.round(barHeight * sources[i].percent / 100));
            column.fillTop = top + barHeight - filled;
            column.fillHeight = filled;
            column.rgb = colorFor(sources[i].percent, opts.warn, opts.crit).rgb;
        }
        columns.push(column);
    }

    // The only light element of the applet is the reference mark, not data.
    var mark = null;
    if (data && opts.showPaceMark) {
        var p = Usage.pace(data.session, Usage.SESSION_WINDOW, opts.now);
        if (p)
            mark = { x: columns[0].x - 1, width: BAR_WIDTH + 2,
                     y: top + barHeight - Math.round(barHeight * p.fraction) };
    }

    return { columns: columns, mark: mark };
};

var barsWidth = function() { return BAR_WIDTH * 2 + BAR_GAP; };

if (typeof module !== "undefined")
    module.exports = { CALM, WATCH, ALARM, BAR_CELLS, BAR_WIDTH, BAR_GAP, LEAD,
                       colorFor, isMuted, pauseText, titleMarkup, panelMarkup, PACE_MARK_SPAN,
                       paceCell, barMarkup,
                       limitBlock, tooltipMarkup, barLayout, barsWidth };
