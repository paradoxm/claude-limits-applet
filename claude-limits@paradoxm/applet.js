const Applet = imports.ui.applet;
const ByteArray = imports.byteArray;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Settings = imports.ui.settings;
const Soup = imports.gi.Soup;
const St = imports.gi.St;

const UUID = "claude-limits@paradoxm";
const API_URL = "https://api.anthropic.com/api/oauth/usage";

// The logic lives in lib/ and knows nothing about Cinnamon. This file is the
// thin layer between it and the panel: widgets, network, files, cairo and
// timers, and nothing else.
const Lib = imports.ui.appletManager.applets[UUID].lib;
const Auth = Lib.auth;
const Policy = Lib.policy;
const Strings = Lib.strings;
const Usage = Lib.usage;
const View = Lib.view;

function ClaudeLimitsApplet(orientation, panelHeight, instanceId) {
    this._init(orientation, panelHeight, instanceId);
}

ClaudeLimitsApplet.prototype = {
    __proto__: Applet.Applet.prototype,

    _init: function(orientation, panelHeight, instanceId) {
        Applet.Applet.prototype._init.call(this, orientation, panelHeight, instanceId);
        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        this._state = { data: null, fetchedAt: 0, error: null, pausedReason: null,
                        inFlight: false, backoffUntil: 0, serverWaitUntil: 0,
                        lastCallAt: 0 };

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        const redraw = this._onSettingsChanged.bind(this);
        this.settings.bind("language", "language", redraw);
        this.settings.bind("display-mode", "displayMode", redraw);
        this.settings.bind("show-pace-mark", "showPaceMark", redraw);
        this.settings.bind("threshold-warn", "thresholdWarn", redraw);
        this.settings.bind("threshold-crit", "thresholdCrit", redraw);
        this.settings.bind("polling-enabled", "pollingEnabled", redraw);
        this.settings.bind("click-to-refresh", "clickToRefresh", redraw);
        this.settings.bind("skip-when-idle", "skipWhenIdle", redraw);
        this.settings.bind("credentials-path", "credentialsPath", redraw);
        // Only the interval itself touches the timer. The thresholds are spin
        // buttons, and every step would otherwise postpone the next poll.
        this.settings.bind("update-interval", "updateInterval",
                           this._onIntervalChanged.bind(this));

        // The whole thrift state survives a Cinnamon restart, not just part of
        // it: restarting the panel during an hour-long back-off after a 429
        // used to reset that back-off to zero.
        this.settings.bind("last-api-call-time", "lastApiCallTime");
        this.settings.bind("backoff-until", "backoffUntil");
        this.settings.bind("backoff-step", "backoffStep");
        this.settings.bind("server-wait-until", "serverWaitUntil");
        this._state.lastCallAt = this.lastApiCallTime || 0;
        this._state.backoffUntil = this.backoffUntil || 0;
        this._state.serverWaitUntil = this.serverWaitUntil || 0;
        this._backoff = this.backoffStep || Policy.BACKOFF_START;

        this._userAgent = Auth.userAgentFor(this._claudeSymlinkTarget());
        this._session = new Soup.Session({ timeout: 15 });
        this._cancellable = null;
        this._timerId = 0;
        this._kickId = 0;

        this._applet_tooltip._tooltip.add_style_class_name("claude-limits-tooltip");
        this._enterId = this.actor.connect("enter-event", this._renderTooltip.bind(this));

        // this.actor is already an St.BoxLayout, and it is the actor Cinnamon
        // turns vertical in a side panel; a container of our own inside it
        // would be an extra actor that never gets turned.
        this.actor.add_style_class_name("claude-limits-box");

        this._area = new St.DrawingArea();
        this._area.connect("repaint", this._onRepaint.bind(this));
        this.actor.add_actor(this._area);

        // applet-label gives the numbers the same font metrics and padding as
        // every other panel applet; set_label_actor gives them a name for
        // accessibility.
        this._label = new St.Label({ style_class: "applet-label claude-limits-label",
                                     y_align: Clutter.ActorAlign.CENTER });
        this._label.clutter_text.set_use_markup(true);
        this.actor.add_actor(this._label);
        this.actor.set_label_actor(this._label);

        this._applyMode();
        this._resize(panelHeight);
        this._render();
        this._renderTooltip();
        this._kickOff();
        this._restartTimer();
    },

    // ── Input and output ───────────────────────────────────────────────────
    _claudeSymlinkTarget: function() {
        try {
            return Gio.File.new_for_path(GLib.get_home_dir() + "/.local/bin/claude")
                .query_info("standard::symlink-target",
                            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null)
                .get_symlink_target();
        } catch (e) {
            return null;
        }
    },

    _credentialsPath: function() {
        let path = this.credentialsPath || "";
        if (path.startsWith("file://"))
            path = Gio.File.new_for_uri(path).get_path() || "";
        return path.length > 0 ? path : GLib.get_home_dir() + "/.claude/.credentials.json";
    },

    // The token is re-read before every request: Claude Code refreshes it on
    // its own and the applet has to pick the new one up.
    _token: function() {
        const path = this._credentialsPath();
        let text;
        try {
            const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
            if (!ok) throw new Error();
            text = ByteArray.toString(contents);
        } catch (e) {
            return { error: { code: "unreadable", path: path } };
        }
        return Auth.readCredentials(text, Date.now());
    },

    _claudeIdle: function() {
        try {
            const info = Gio.File.new_for_path(GLib.get_home_dir() + "/.claude/history.jsonl")
                .query_info("time::modified", Gio.FileQueryInfoFlags.NONE, null);
            return this._now() - info.get_attribute_uint64("time::modified") > Policy.IDLE_AFTER;
        } catch (e) {
            return false;   // cannot tell, so keep polling
        }
    },

    _now: function() {
        return Math.floor(GLib.get_real_time() / 1e6);
    },

    _fetch: function(manual) {
        const now = this._now();
        const decision = Policy.fetchDecision(this._state, {
            now: now, manual: manual,
            pollingEnabled: this.pollingEnabled, skipWhenIdle: this.skipWhenIdle,
            isClaudeIdle: this._claudeIdle.bind(this)
        });
        if (decision !== "fetch") {
            const paused = Policy.pausedReason(decision);
            if (paused !== this._state.pausedReason) {
                this._state.pausedReason = paused;
                this._render();
            }
            return;
        }
        this._state.pausedReason = null;

        const credentials = this._token();
        if (credentials.error) {
            this._fail(credentials.error, false);
            return;
        }

        const message = Soup.Message.new("GET", API_URL);
        message.request_headers.replace("User-Agent", this._userAgent);
        message.request_headers.append("Authorization", "Bearer " + credentials.token);
        message.request_headers.append("anthropic-beta", "oauth-2025-04-20");
        message.request_headers.append("Accept", "application/json");

        this._state.inFlight = true;
        this._state.lastCallAt = now;
        this.lastApiCallTime = now;
        this._cancellable = new Gio.Cancellable();

        this._session.send_and_read_async(message, GLib.PRIORITY_LOW, this._cancellable,
                                          (session, result) => {
            if (this._cancellable === null) return;   // the applet is gone
            this._state.inFlight = false;
            try {
                const bytes = session.send_and_read_finish(result);
                // status_code, not get_status(): Soup.Status is an enumeration
                // and 429 is not one of its members, so get_status() throws
                // instead of returning it — the one status we most need to see.
                const status = message.status_code;
                if (status !== 200) {
                    const failure = Policy.describeHttpFailure(status);
                    const retryAfter = Policy.retryAfterSeconds(
                        message.get_response_headers().get_one("Retry-After"));
                    this._fail(failure.error, failure.backoff, retryAfter);
                    return;
                }
                this._accept(JSON.parse(ByteArray.toString(bytes.get_data())));
            } catch (e) {
                this._fail({ code: "exception", text: String(e.message || e) }, true);
            }
        });
    },

    _accept: function(json) {
        this._state.data = Usage.parseUsage(json);
        this._state.fetchedAt = this._now();
        this._state.error = null;
        this._state.pausedReason = null;
        this._setBackoff(0, Policy.BACKOFF_START);
        this._setServerWait(0);
        this._render();
    },

    _fail: function(error, backoff, retryAfter) {
        this._state.error = error;
        if (retryAfter) this._setServerWait(this._now() + retryAfter);
        if (backoff) {
            this._state.pausedReason = retryAfter ? "rate-limited" : "backoff";
            this._setBackoff(this._now() + Policy.backoffDelay(this._backoff, retryAfter),
                             Policy.nextBackoff(this._backoff));
        }
        global.logWarning(UUID + ": " + Strings.errorText(error));
        this._render();
    },

    // The wait the server named, kept apart from our own ladder because a click
    // may override the ladder and may not override this.
    _setServerWait: function(until) {
        this._state.serverWaitUntil = until;
        this.serverWaitUntil = until;
    },

    _setBackoff: function(until, step) {
        this._state.backoffUntil = until;
        this._backoff = step;
        this.backoffUntil = until;
        this.backoffStep = step;
    },

    // ── Drawing ────────────────────────────────────────────────────────────
    _viewOptions: function() {
        return {
            t: Strings.stringsFor(this.language),
            warn: this.thresholdWarn, crit: this.thresholdCrit,
            showPaceMark: this.showPaceMark, clickToRefresh: this.clickToRefresh,
            now: this._now()
        };
    },

    _applyMode: function() {
        const bars = this.displayMode === "bars" || this.displayMode === "both";
        this._area.visible = bars;
        this._label.visible = this.displayMode === "numbers" || this.displayMode === "both";
        this._area.set_width(bars ? View.barsWidth() : 0);
    },

    // The height is set explicitly: an St.DrawingArea has no preferred size of
    // its own, and without this the bars collapse to a single pixel.
    _resize: function(panelHeight) {
        this._area.set_height(Math.max(16, panelHeight - 10));
    },

    _render: function() {
        this._area.queue_repaint();
        this._label.clutter_text.set_markup(View.panelMarkup(this._state.data,
                                                             this._viewOptions()));
        this.actor.opacity = View.isMuted(this._state) ? 140 : 255;
    },

    // The tooltip is a static string whose contents depend on the current
    // time: the countdown to the reset and "updated N minutes ago". Without
    // recomputing it as the pointer arrives it would show what was true at the
    // moment of the request, which is to say "just now", always.
    _renderTooltip: function() {
        this.set_applet_tooltip(View.tooltipMarkup(this._state, this._viewOptions()), true);
    },

    _onRepaint: function(area) {
        const cr = area.get_context();
        const [, height] = area.get_surface_size();
        const fg = area.get_theme_node().get_foreground_color();
        const layout = View.barLayout(height, this._state.data, this._viewOptions());

        for (let column of layout.columns) {
            // The empty part is a recess, not an object.
            cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, 0.16);
            cr.rectangle(column.x, column.top, column.width, column.height);
            cr.fill();

            if (column.rgb) {
                cr.setSourceRGBA(column.rgb[0], column.rgb[1], column.rgb[2], 1);
                cr.rectangle(column.x, column.fillTop, column.width, column.fillHeight);
                cr.fill();
            }
        }

        if (layout.mark) {
            cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, 0.75);
            cr.rectangle(layout.mark.x, layout.mark.y, layout.mark.width, 1);
            cr.fill();
        }

        cr.$dispose();
    },

    // ── Timers and lifecycle ───────────────────────────────────────────────
    _restartTimer: function() {
        this._stopTimer();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW,
            Math.max(60, this.updateInterval * 60), () => {
                this._fetch(false);
                return GLib.SOURCE_CONTINUE;
            });
    },

    _kickOff: function() {
        this._kickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW,
            Policy.kickDelay(this._state.lastCallAt, this._now()), () => {
                this._kickId = 0;
                this._fetch(false);
                return GLib.SOURCE_REMOVE;
            });
    },

    _stopTimer: function() {
        if (this._timerId > 0) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    },

    _onSettingsChanged: function() {
        if (!this._area) return;
        this._applyMode();
        this._render();
        this._renderTooltip();
    },

    _onIntervalChanged: function() {
        if (!this._area) return;
        this._restartTimer();
    },

    on_applet_clicked: function() {
        if (this.clickToRefresh)
            this._fetch(true);
    },

    on_panel_height_changed: function() {
        this._resize(this._panelHeight);
        this._area.queue_repaint();
    },

    on_applet_removed_from_panel: function() {
        this._stopTimer();
        if (this._kickId > 0) {
            GLib.source_remove(this._kickId);
            this._kickId = 0;
        }
        if (this._enterId) {
            this.actor.disconnect(this._enterId);
            this._enterId = 0;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        this.settings.finalize();
    }
};

function main(metadata, orientation, panelHeight, instanceId) {
    return new ClaudeLimitsApplet(orientation, panelHeight, instanceId);
}
