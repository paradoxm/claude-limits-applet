#!/usr/bin/env bash
# Claude Code hook: silent while the limit holds — empty output costs Claude no tokens.
# The applet writes ~/.claude/limit-watch/{status,alert}.json; this script only reads them.
# Usage: claude-code-hook.sh SessionStart | UserPromptSubmit | PostToolUse
dir="$HOME/.claude/limit-watch"
alert="$dir/alert.json"
status="$dir/status.json"
input=$(cat)
event=$1

if [ "$event" = SessionStart ]; then
    # `startup` and `resume` are a new session: the permission to pay does not survive a restart
    sid=$(jq -r 'select(.source == "startup" or .source == "resume") | .session_id // empty' <<<"$input")
    [ -n "$sid" ] && rm -f "$dir/allowed/$sid"
fi

now=$(date +%s)
if [ -f "$alert" ]; then
    # Without jq the stop cannot be checked; passing the work silently costs more than stopping
    command -v jq >/dev/null || { echo "limit-watch: лимит исчерпан, а jq нет — работа остановлена" >&2; exit 2; }
    key=$(jq -r .key "$alert") text=$(jq -r .text "$alert") notice=$(jq -r '.notice // .text' "$alert")
    until=$(jq -r '.until // 0' "$alert")
fi
# A reset already passed: the applet has not ticked since, and its alert no longer holds
if [ -n "$key" ] && [[ $key == over:* ]] && [ "$until" -le "$now" ]; then key=; fi
if [ -z "$key" ] && [ -f "$status" ] && age=$(( now - $(stat -c %Y "$status") )) && [ "$age" -gt 1800 ] \
    && [ "$age" -gt "$(jq -r '.stale_after // 1800' "$status")" ]; then
    # The applet will not say it is gone: an old status.json is the only trace
    key="dead:$(stat -c %Y "$status")"
    notice="⚠ limit-watch: апплет claude-limits не обновляет расход $(( age / 60 )) мин"
    text="limit-watch: апплет claude-limits не обновлял $status $(( age / 60 )) мин, расход не виден. Скажи человеку: апплет выключен или Cinnamon не запущен."
fi
[ -n "$key" ] || exit 0

# Subagents go by their session's permission: they share `session_id` with the main agent
sid=$(jq -r '.session_id // empty' <<<"$input")
allowed="$dir/allowed/$sid"

if [[ $key == over:* ]]; then
    # Allowed in this session and the reset is still ahead: silence, the work is paid for
    [ -n "$sid" ] && [ "$(cat "$allowed" 2>/dev/null || echo 0)" -gt "$now" ] && exit 0
    if [ -n "$sid" ] && [ "$event" = UserPromptSubmit ] \
        && jq -e '(.prompt // "") | test("^\\s*можно за деньги"; "i")' <<<"$input" >/dev/null; then
        mkdir -p "$dir/allowed" && printf '%s' "$until" >"$allowed"
        exit 0
    fi
    stop="$notice. Claude остановлен; чтобы продолжить, начни сообщение со слов «можно за деньги»."
    case $event in
        # The prompt never reaches the model: not a single token
        UserPromptSubmit) jq -n --arg r "$stop" '{decision: "block", reason: $r}' ;;
        PostToolUse) jq -n --arg r "$stop" '{continue: false, stopReason: $r}' ;;
        *) jq -n --arg r "$stop" '{systemMessage: $r}' ;;
    esac
    exit 0
fi

# The rest are warnings and do not stop the work: to the human and the main agent, once a session
jq -e 'has("agent_id")' <<<"$input" >/dev/null && exit 0
mark="$dir/seen/${sid:-unknown}"
[ "$event" != SessionStart ] && [ "$(cat "$mark" 2>/dev/null)" = "$key" ] && exit 0
mkdir -p "$dir/seen" && printf '%s' "$key" >"$mark"
jq -n --arg event "$event" --arg text "$text" --arg notice "$notice" \
    '{hookSpecificOutput: {hookEventName: $event, additionalContext: $text}, systemMessage: $notice}'
