// The real api.anthropic.com/api/oauth/usage response, captured 2026-09-02.
// The tests run against this rather than against an invented shape.
const REAL_RESPONSE = {
    five_hour: { utilization: 59.0, resets_at: "2026-09-02T09:20:00.221436+00:00",
                 limit_dollars: null, used_dollars: null, locked_reason: null },
    seven_day: { utilization: 8.0, resets_at: "2026-09-03T03:00:00.221457+00:00",
                 limit_dollars: null, used_dollars: null, locked_reason: null },
    seven_day_opus: null,
    nimbus_quill: { utilization: 0.0, resets_at: null },
    extra_usage: { is_enabled: true, used_credits: 0.0, currency: "USD" },
    limits: [
        { kind: "session", group: "session", percent: 59, severity: "normal",
          resets_at: "2026-09-02T09:20:00.221436+00:00", scope: null, is_active: true },
        { kind: "weekly_all", group: "weekly", percent: 8, severity: "normal",
          resets_at: "2026-09-03T03:00:00.221457+00:00", scope: null, is_active: false },
        { kind: "weekly_scoped", group: "weekly", percent: 0, severity: "normal",
          resets_at: null, scope: { model: { id: null, display_name: "Fable" } },
          is_active: false }
    ],
    member_dashboard_available: false
};

// The same response without the limits array: its shape before that appeared.
const LEGACY_RESPONSE = {
    five_hour: { utilization: 59.0, resets_at: "2026-09-02T09:20:00.221436+00:00" },
    seven_day: { utilization: 8.0, resets_at: "2026-09-03T03:00:00.221457+00:00" }
};

const CREDENTIALS = JSON.stringify({
    claudeAiOauth: {
        accessToken: "sk-ant-oat01-example  ",
        refreshToken: "sk-ant-ort01-example",
        expiresAt: 1788350793925,
        subscriptionType: "team"
    }
});

module.exports = { REAL_RESPONSE, LEGACY_RESPONSE, CREDENTIALS };
