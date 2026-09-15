#!/bin/zsh

# Konfigurationsbasierter Local-AI-Launcher fuer macOS.
# Provider, Modell, Framework und alle sichtbaren Werte kommen aus local-ai.json.
set -u

SCRIPT_FILE="${0:A}"
LOCAL_DEV_DIR="${SCRIPT_FILE:h}"
PROJECT_ROOT="${LOCAL_DEV_DIR:h}"
CONFIG_FILE="${LOCAL_DEV_CONFIG_FILE:-$LOCAL_DEV_DIR/local-ai.json}"
EXAMPLE_CONFIG="$LOCAL_DEV_DIR/local-ai.example.json"
STATE_DIR="${LOCAL_DEV_STATE_DIR:-$LOCAL_DEV_DIR/.local-ai-state}"
LOG_FILE="${LOCAL_DEV_LOG_FILE:-$LOCAL_DEV_DIR/local-ai.log}"

export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

JQ_BIN=""
ACTIVE_SOURCE=""
ACTIVE_FRAMEWORK=""
SOURCE_TYPE=""
PROTOCOL=""
PROVIDER=""
SOURCE_NAME=""
MODEL=""
HOST=""
PORT=""
BASE_URL=""
HEALTH_URL=""
START_TIMEOUT="180"
FRAMEWORK_ADAPTER=""
FRAMEWORK_NAME=""
FRAMEWORK_COMMAND=""
WORKING_DIRECTORY=""
CHOSEN_PROFILE=""

UI_WIDTH=76
C_RESET=""
C_DIM=""
C_ACCENT=""
C_OK=""
C_WARN=""
C_ERROR=""

init_ui() {
    local columns="$(tput cols 2>/dev/null || printf '76')"
    [[ "$columns" == <-> ]] || columns=76
    (( columns < 58 )) && columns=58
    (( columns > 96 )) && columns=96
    UI_WIDTH=$columns

    if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
        C_RESET=$'\e[0m'
        C_DIM=$'\e[2m'
        C_ACCENT=$'\e[38;5;81m'
        C_OK=$'\e[38;5;84m'
        C_WARN=$'\e[38;5;214m'
        C_ERROR=$'\e[38;5;203m'
    fi
}

repeat_char() {
    local character="$1"
    local count="$2"
    local result=""
    while (( count > 0 )); do
        result+="$character"
        (( count -= 1 ))
    done
    printf '%s' "$result"
}

fit_text() {
    local text="$1"
    local width="$2"
    if (( ${#text} > width )); then
        text="${text[1,$(( width - 1 ))]}…"
    fi
    printf '%-*s' "$width" "$text"
}

panel_line() {
    local content="$1"
    local inner_width=$(( UI_WIDTH - 4 ))
    printf '│ '
    fit_text "$content" "$inner_width"
    printf ' │\n'
}

show_dashboard() {
    [[ -t 1 ]] && printf '\033[2J\033[H'
    printf '%s╭' "$C_ACCENT"
    repeat_char '─' $(( UI_WIDTH - 2 ))
    printf '╮%s\n' "$C_RESET"
    panel_line "VIBECODE  /  LOCAL AI SESSION"
    printf '%s├' "$C_DIM"
    repeat_char '─' $(( UI_WIDTH - 2 ))
    printf '┤%s\n' "$C_RESET"
    panel_line "PROVIDER   $SOURCE_NAME"
    panel_line "MODEL      $MODEL"
    panel_line "ENDPOINT   $BASE_URL"
    panel_line "FRAMEWORK  $FRAMEWORK_NAME"
    panel_line "SESSION    $ACTIVE_SOURCE  →  $ACTIVE_FRAMEWORK"
    printf '%s╰' "$C_ACCENT"
    repeat_char '─' $(( UI_WIDTH - 2 ))
    printf '╯%s\n\n' "$C_RESET"
}

ui_step() {
    printf '%s◇%s %s\n' "$C_ACCENT" "$C_RESET" "$1"
}

ui_ok() {
    printf '%s✓%s %s\n' "$C_OK" "$C_RESET" "$1"
}

ui_warn() {
    printf '%s!%s %s\n' "$C_WARN" "$C_RESET" "$1"
}

log() {
    local message="$1"
    mkdir -p "${LOG_FILE:h}"
    printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$message" >> "$LOG_FILE"
}

fail() {
    printf '%s×%s %s\n' "$C_ERROR" "$C_RESET" "$1" >&2
    if [[ -t 0 && "${TERM_PROGRAM:-}" == "Apple_Terminal" ]]; then
        printf '\nEnter druecken, um das Fenster zu schliessen ...'
        read -r
    fi
    exit 1
}

find_jq() {
    JQ_BIN="$(command -v jq 2>/dev/null || true)"
    [[ -n "$JQ_BIN" ]] || fail "jq fehlt. Installation: brew install jq"
}

ensure_config() {
    if [[ ! -s "$CONFIG_FILE" ]]; then
        [[ -f "$EXAMPLE_CONFIG" ]] || fail "Konfigurationsvorlage fehlt: $EXAMPLE_CONFIG"
        mkdir -p "${CONFIG_FILE:h}"
        cp "$EXAMPLE_CONFIG" "$CONFIG_FILE" || fail "Konfiguration konnte nicht angelegt werden."
        log "Standardkonfiguration angelegt: $CONFIG_FILE"
    fi
}

migrate_legacy_config() {
    "$JQ_BIN" -e '
        (.providers | type == "object") and
        (.provider | type == "string") and
        (.model | type == "string") and
        (.framework | type == "string")
    ' "$CONFIG_FILE" >/dev/null 2>&1 && return 0

    "$JQ_BIN" -e '
        (.sources | type == "object") and
        (.active_source | type == "string") and
        (.active_framework | type == "string")
    ' "$CONFIG_FILE" >/dev/null 2>&1 || return 0

    local temp_file="$(mktemp "${CONFIG_FILE}.migration.XXXXXX")" || fail "Migration konnte nicht vorbereitet werden."
    local backup_file="${CONFIG_FILE}.pre-v2.bak"
    "$JQ_BIN" '
        .provider = .active_source |
        .framework = .active_framework |
        .model = .sources[.active_source].model |
        .providers = (
            .sources |
            with_entries(
                .value |= (
                    .default_model = .model |
                    .provider_id = .provider |
                    if .type == "mlx" then
                        .readiness_path = (.readiness_path // "/chat/completions")
                    else
                        .
                    end |
                    del(.model, .provider)
                )
            )
        ) |
        .config_version = 2 |
        del(.active_source, .active_framework, .sources)
    ' "$CONFIG_FILE" > "$temp_file" || {
        rm -f "$temp_file"
        fail "Bestehende Konfiguration konnte nicht migriert werden."
    }

    if [[ ! -e "$backup_file" ]]; then
        cp "$CONFIG_FILE" "$backup_file" || {
            rm -f "$temp_file"
            fail "Sicherung der bisherigen Konfiguration fehlgeschlagen."
        }
    fi
    mv "$temp_file" "$CONFIG_FILE" || fail "Migrierte Konfiguration konnte nicht aktiviert werden."
    log "Konfiguration auf Version 2 migriert; Sicherung: $backup_file"
    ui_ok "Konfiguration aktualisiert (Sicherung: ${backup_file:t})"
}

source_value() {
    local field="$1"
    "$JQ_BIN" -er --arg profile "$ACTIVE_SOURCE" ".providers[\$profile].${field} // empty" "$CONFIG_FILE" 2>/dev/null
}

framework_value() {
    local field="$1"
    "$JQ_BIN" -er --arg profile "$ACTIVE_FRAMEWORK" ".frameworks[\$profile].${field} // empty" "$CONFIG_FILE" 2>/dev/null
}

expand_home() {
    local value="$1"
    case "$value" in
        '~') printf '%s\n' "$HOME" ;;
        '~/'*) printf '%s/%s\n' "$HOME" "${value#\~/}" ;;
        '$HOME') printf '%s\n' "$HOME" ;;
        '$HOME/'*) printf '%s/%s\n' "$HOME" "${value#\$HOME/}" ;;
        *) printf '%s\n' "$value" ;;
    esac
}

resolve_executable() {
    local configured="$1"
    local expanded="$(expand_home "$configured")"
    if [[ "$expanded" == */* ]]; then
        [[ -x "$expanded" ]] || return 1
        printf '%s\n' "$expanded"
    else
        command -v "$expanded" 2>/dev/null
    fi
}

load_config() {
    find_jq
    ensure_config
    migrate_legacy_config

    "$JQ_BIN" -e '
        (.provider | type == "string" and length > 0) and
        (.model | type == "string" and length > 0) and
        (.framework | type == "string" and length > 0) and
        (.providers[.provider] | type == "object") and
        (.frameworks[.framework] | type == "object") and
        (.providers[.provider].type | IN("mlx", "ollama", "openai-compatible")) and
        (.providers[.provider].protocol | IN("openai-chat", "openai-responses", "anthropic")) and
        (.providers[.provider].provider_id | type == "string" and test("^[A-Za-z0-9._-]+$")) and
        (.providers[.provider].name | type == "string" and length > 0) and
        (.frameworks[.framework].adapter | IN("opencode", "codex", "claude", "generic")) and
        (.frameworks[.framework].name | type == "string" and length > 0) and
        (.frameworks[.framework].command | type == "string" and length > 0) and
        ((.frameworks[.framework].args // []) | type == "array")
    ' "$CONFIG_FILE" >/dev/null 2>&1 || fail "Ungueltige Konfiguration: $CONFIG_FILE"

    ACTIVE_SOURCE="$("$JQ_BIN" -r '.provider' "$CONFIG_FILE")"
    ACTIVE_FRAMEWORK="$("$JQ_BIN" -r '.framework' "$CONFIG_FILE")"
    SOURCE_TYPE="$(source_value type)"
    PROTOCOL="$(source_value protocol)"
    PROVIDER="$(source_value provider_id)"
    SOURCE_NAME="$(source_value name)"
    MODEL="$("$JQ_BIN" -r '.model' "$CONFIG_FILE")"
    HOST="$(source_value host 2>/dev/null || printf '127.0.0.1')"
    PORT="$(source_value port 2>/dev/null || true)"
    START_TIMEOUT="$("$JQ_BIN" -r '.start_timeout_seconds // 180' "$CONFIG_FILE")"
    FRAMEWORK_ADAPTER="$(framework_value adapter)"
    FRAMEWORK_NAME="$(framework_value name)"
    FRAMEWORK_COMMAND="$(framework_value command)"
    WORKING_DIRECTORY="$(framework_value working_directory 2>/dev/null || printf '.')"

    if [[ "$SOURCE_TYPE" != "openai-compatible" ]]; then
        [[ "$PORT" == <1-65535> ]] || fail "Port fuer '$ACTIVE_SOURCE' ist ungueltig."
    fi

    local configured_base="$(source_value base_url 2>/dev/null || true)"
    if [[ -n "$configured_base" ]]; then
        BASE_URL="${configured_base%/}"
    else
        [[ -n "$PORT" ]] || fail "base_url oder port fehlt fuer '$ACTIVE_SOURCE'."
        BASE_URL="http://${HOST}:${PORT}/v1"
    fi

    local configured_health="$(source_value health_url 2>/dev/null || true)"
    local health_path="$(source_value health_path 2>/dev/null || true)"
    if [[ -n "$configured_health" ]]; then
        HEALTH_URL="$configured_health"
    elif [[ -n "$health_path" && -n "$PORT" ]]; then
        HEALTH_URL="http://${HOST}:${PORT}${health_path}"
    else
        HEALTH_URL="${BASE_URL%/}/models"
    fi
}

pid_file() {
    printf '%s/%s.pid\n' "$STATE_DIR" "$ACTIVE_SOURCE"
}

health_ok() {
    command -v curl >/dev/null 2>&1 || return 1
    curl --silent --show-error --fail --max-time 2 "$HEALTH_URL" >/dev/null 2>&1
}

mlx_runtime_matches_config() {
    [[ "$SOURCE_TYPE" == "mlx" ]] || return 0
    command -v lsof >/dev/null 2>&1 || return 0

    local configured_command="$(source_value server_command 2>/dev/null || true)"
    [[ -n "$configured_command" ]] || return 1
    local expected_name="${$(expand_home "$configured_command"):t}"
    local -a listener_pids
    listener_pids=("${(@f)$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)}")
    (( ${#listener_pids} == 1 )) || return 1

    local listener_command="$(ps -p "$listener_pids[1]" -o command= 2>/dev/null)"
    [[ "$listener_command" == *"$expected_name"* ]]
}

inference_ready() {
    local readiness_path="$(source_value readiness_path 2>/dev/null || true)"
    [[ -n "$readiness_path" ]] || return 0
    local readiness_timeout="$(source_value readiness_timeout_seconds 2>/dev/null || printf '30')"
    local readiness_tokens="$(source_value readiness_max_tokens 2>/dev/null || printf '1')"
    [[ "$readiness_timeout" == <1-300> ]] || readiness_timeout=30
    [[ "$readiness_tokens" == <1-64> ]] || readiness_tokens=1

    local request_body="$("$JQ_BIN" -cn \
        --arg model "$MODEL" \
        --argjson max_tokens "$readiness_tokens" \
        '{
            model: $model,
            messages: [{role: "user", content: "Reply briefly."}],
            max_tokens: $max_tokens,
            temperature: 0,
            stream: false
        }')"
    curl --silent --show-error --fail \
        --max-time "$readiness_timeout" \
        "${BASE_URL%/}${readiness_path}" \
        -H 'Content-Type: application/json' \
        -d "$request_body" 2>/dev/null |
        "$JQ_BIN" -e '(.choices | type == "array") and (length > 0)' >/dev/null 2>&1
}

source_ready() {
    health_ok || return 1
    if [[ "$SOURCE_TYPE" == "mlx" ]]; then
        local models_url="${BASE_URL%/}/models"
        curl --silent --show-error --fail --max-time 2 "$models_url" 2>/dev/null |
            "$JQ_BIN" -e --arg model "$MODEL" 'any(.data[]?; .id == $model)' >/dev/null 2>&1
        (( $? == 0 )) || return 1
        mlx_runtime_matches_config || return 1
    fi
    inference_ready
}

current_mlx_models() {
    curl --silent --show-error --fail --max-time 2 "${BASE_URL%/}/models" 2>/dev/null |
        "$JQ_BIN" -r '[.data[]?.id] | join(", ")' 2>/dev/null
}

offer_external_mlx_restart() {
    local current_models="$(current_mlx_models)"
    ui_warn "MLX liefert aktuell: ${current_models:-unbekannt}"
    [[ -t 0 ]] || fail "Beende den extern gestarteten MLX-Server oder waehle dessen Modell-ID."

    local -a listener_pids
    listener_pids=("${(@f)$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)}")
    (( ${#listener_pids} == 1 )) || fail "Der Prozess am MLX-Port konnte nicht eindeutig bestimmt werden."
    local listener_pid="$listener_pids[1]"
    local listener_command="$(ps -p "$listener_pid" -o command= 2>/dev/null)"
    local configured_command="$(source_value server_command 2>/dev/null || true)"
    local expected_name="${$(expand_home "$configured_command"):t}"
    if [[ "$listener_command" != *mlx_lm.server* && "$listener_command" != *spark-mlx-server* && "$listener_command" != *"$expected_name"* ]]; then
        fail "Port $PORT gehoert nicht eindeutig zu einem MLX-Server und wird nicht beendet."
    fi

    printf 'Diesen MLX-Server neu mit %s starten? [j/N]: ' "$MODEL"
    local confirmation
    read -r confirmation
    [[ "$confirmation" == [Jj] || "$confirmation" == [Jj][Aa] ]] || fail "Modellwechsel abgebrochen."

    ui_step "Beende den bisherigen MLX-Prozess $listener_pid"
    kill "$listener_pid" 2>/dev/null || fail "MLX-Prozess $listener_pid konnte nicht beendet werden."
    local attempt=0
    while kill -0 "$listener_pid" 2>/dev/null && (( attempt < 40 )); do
        sleep 0.25
        (( attempt += 1 ))
    done
    kill -0 "$listener_pid" 2>/dev/null && fail "MLX-Prozess $listener_pid wurde nicht rechtzeitig beendet."
    ui_ok "Bisheriger MLX-Server wurde beendet"
}

expand_placeholders() {
    local value="$1"
    value="${value//\{provider\}/$PROVIDER}"
    value="${value//\{model\}/$MODEL}"
    value="${value//\{model_ref\}/$PROVIDER\/$MODEL}"
    value="${value//\{base_url\}/$BASE_URL}"
    expand_home "$value"
}

start_source_process() {
    mkdir -p "$STATE_DIR" "${LOG_FILE:h}"
    local command_path=""
    local -a command_args
    command_args=()

    case "$SOURCE_TYPE" in
        mlx)
            local configured_command="$(source_value server_command 2>/dev/null || true)"
            [[ -n "$configured_command" ]] || fail "server_command fehlt fuer den MLX-Provider."
            command_path="$(resolve_executable "$configured_command" || true)"
            [[ -n "$command_path" ]] || fail "MLX-Server nicht gefunden: $configured_command"
            local configured_arg
            while IFS= read -r configured_arg; do
                command_args+=("$(expand_placeholders "$configured_arg")")
            done < <("$JQ_BIN" -r --arg profile "$ACTIVE_SOURCE" '.providers[$profile].server_args[]?' "$CONFIG_FILE")
            command_args+=(--model "$MODEL" --host "$HOST" --port "$PORT")
            ui_step "Starte $SOURCE_NAME mit $MODEL"
            nohup "$command_path" "${command_args[@]}" >> "$LOG_FILE" 2>&1 &
            ;;
        ollama)
            local configured_command="$(source_value server_command 2>/dev/null || printf 'ollama')"
            command_path="$(resolve_executable "$configured_command" || true)"
            [[ -n "$command_path" ]] || fail "Ollama wurde nicht gefunden."
            ui_step "Starte $SOURCE_NAME"
            nohup env "OLLAMA_HOST=${HOST}:${PORT}" "$command_path" serve >> "$LOG_FILE" 2>&1 &
            ;;
        openai-compatible)
            local configured_arg
            while IFS= read -r configured_arg; do
                command_args+=("$(expand_placeholders "$configured_arg")")
            done < <("$JQ_BIN" -r --arg profile "$ACTIVE_SOURCE" '.providers[$profile].start_command[]?' "$CONFIG_FILE")
            (( ${#command_args} > 0 )) || fail "Der Provider antwortet nicht und hat keinen start_command."
            local first="$command_args[1]"
            command_path="$(resolve_executable "$first" || true)"
            [[ -n "$command_path" ]] || fail "Startbefehl nicht gefunden: $first"
            command_args[1]="$command_path"
            ui_step "Starte $SOURCE_NAME"
            nohup "${command_args[@]}" >> "$LOG_FILE" 2>&1 &
            ;;
    esac

    local source_pid=$!
    printf '%s\n' "$source_pid" > "$(pid_file)"
    log "Provider '$ACTIVE_SOURCE' gestartet (PID $source_pid)."
}

wait_for_source() {
    local elapsed=0
    while (( elapsed < START_TIMEOUT )); do
        if source_ready; then
            ui_ok "$SOURCE_NAME ist bereit"
            log "$SOURCE_NAME ist bereit: $BASE_URL"
            return 0
        fi
        sleep 2
        (( elapsed += 2 ))
        if (( elapsed % 10 == 0 )); then
            printf '%s  Warte auf die Modellquelle · %ss / %ss%s\r' "$C_DIM" "$elapsed" "$START_TIMEOUT" "$C_RESET"
        fi
    done
    printf '\n'
    fail "$SOURCE_NAME wurde nicht rechtzeitig bereit. Log: $LOG_FILE"
}

ensure_ollama_model() {
    [[ "$SOURCE_TYPE" == "ollama" ]] || return 0
    local configured_command="$(source_value server_command 2>/dev/null || printf 'ollama')"
    local ollama_command="$(resolve_executable "$configured_command" || true)"
    [[ -n "$ollama_command" ]] || fail "Ollama wurde nicht gefunden."
    if env "OLLAMA_HOST=${HOST}:${PORT}" "$ollama_command" show "$MODEL" >/dev/null 2>&1; then
        ui_ok "Modell $MODEL ist lokal verfuegbar"
        return 0
    fi
    ui_step "Lade Ollama-Modell $MODEL"
    env "OLLAMA_HOST=${HOST}:${PORT}" "$ollama_command" pull "$MODEL" || fail "Ollama-Modell konnte nicht geladen werden: $MODEL"
}

start_source() {
    if source_ready; then
        ui_ok "$SOURCE_NAME laeuft bereits"
        log "$SOURCE_NAME laeuft bereits: $BASE_URL"
        ensure_ollama_model
        return 0
    fi

    local state_file="$(pid_file)"
    if health_ok && [[ "$SOURCE_TYPE" == "mlx" ]]; then
        if [[ -f "$state_file" ]]; then
            local owned_pid="$(<"$state_file")"
            if [[ "$owned_pid" == <-> ]] && kill -0 "$owned_pid" 2>/dev/null; then
                ui_warn "MLX laeuft mit einem anderen Modell; starte das konfigurierte Modell neu"
                stop_source
            else
                rm -f "$state_file"
                fail "Am MLX-Port laeuft ein extern gestartetes anderes Modell. Beende den Server oder waehle dessen Modell-ID."
            fi
        else
            offer_external_mlx_restart
        fi
    fi

    if [[ -f "$state_file" ]]; then
        local old_pid="$(<"$state_file")"
        if [[ "$old_pid" == <-> ]] && kill -0 "$old_pid" 2>/dev/null; then
            fail "$SOURCE_NAME laeuft als Prozess $old_pid, antwortet aber nicht. Log: $LOG_FILE"
        fi
        rm -f "$state_file"
    fi

    start_source_process
    wait_for_source
    ensure_ollama_model
}

render_opencode_config() {
    local package="@ai-sdk/openai-compatible"
    [[ "$PROTOCOL" == "openai-responses" ]] && package="@ai-sdk/openai"
    [[ "$PROTOCOL" == "anthropic" ]] && package="@ai-sdk/anthropic"

    "$JQ_BIN" -cn \
        --arg provider "$PROVIDER" \
        --arg name "$SOURCE_NAME" \
        --arg model "$MODEL" \
        --arg baseURL "$BASE_URL" \
        --arg package "$package" \
        '{
            "$schema": "https://opencode.ai/config.json",
            "provider": {
                ($provider): {
                    "npm": $package,
                    "name": $name,
                    "options": {
                        "baseURL": $baseURL,
                        "apiKey": "not-needed"
                    },
                    "models": {
                        ($model): {"name": $model}
                    }
                }
            },
            "model": ($provider + "/" + $model)
        }'
}

resolve_working_directory() {
    local expanded="$(expand_home "$WORKING_DIRECTORY")"
    if [[ "$expanded" != /* ]]; then
        expanded="$PROJECT_ROOT/$expanded"
    fi
    [[ -d "$expanded" ]] || fail "Arbeitsordner des Frameworks fehlt: $expanded"
    (cd "$expanded" && pwd -P)
}

profiles_are_compatible() {
    local adapter="$1"
    local source_type="$2"
    local protocol="$3"
    case "$adapter" in
        opencode|generic)
            return 0
            ;;
        codex)
            [[ "$source_type" == "ollama" || "$protocol" == "openai-responses" ]]
            return $?
            ;;
        claude)
            [[ "$protocol" == "anthropic" ]]
            return $?
            ;;
    esac
}

check_framework_compatibility() {
    profiles_are_compatible "$FRAMEWORK_ADAPTER" "$SOURCE_TYPE" "$PROTOCOL" && return 0
    if [[ "$FRAMEWORK_ADAPTER" == "codex" ]]; then
        fail "$FRAMEWORK_NAME braucht Ollama oder eine Responses-kompatible API; '$SOURCE_NAME' bietet $PROTOCOL. OpenCode funktioniert direkt damit."
    fi
    fail "$FRAMEWORK_NAME erwartet eine Anthropic-kompatible API; '$SOURCE_NAME' bietet $PROTOCOL. Nutze dafuer einen passenden Gateway oder OpenCode."
}

launch_framework() {
    check_framework_compatibility
    local executable="$(resolve_executable "$FRAMEWORK_COMMAND" || true)"
    [[ -n "$executable" ]] || fail "Framework-Befehl nicht gefunden: $FRAMEWORK_COMMAND"

    local -a args
    args=()
    local configured_arg
    while IFS= read -r configured_arg; do
        args+=("$(expand_placeholders "$configured_arg")")
    done < <("$JQ_BIN" -r --arg profile "$ACTIVE_FRAMEWORK" '.frameworks[$profile].args[]?' "$CONFIG_FILE")
    local target_directory="$(resolve_working_directory)"
    local model_reference="${PROVIDER}/${MODEL}"
    cd "$target_directory" || fail "Arbeitsordner konnte nicht geoeffnet werden."
    ui_step "Uebergebe $SOURCE_NAME an $FRAMEWORK_NAME"
    log "Starte Framework '$ACTIVE_FRAMEWORK' mit '$ACTIVE_SOURCE'."

    case "$FRAMEWORK_ADAPTER" in
        opencode)
            local opencode_config="$(render_opencode_config)"
            exec env \
                "OPENCODE_CONFIG_CONTENT=$opencode_config" \
                "LOCAL_AI_SOURCE=$ACTIVE_SOURCE" \
                "LOCAL_AI_PROVIDER=$PROVIDER" \
                "LOCAL_AI_MODEL=$MODEL" \
                "LOCAL_AI_BASE_URL=$BASE_URL" \
                "$executable" "${args[@]}" --model "$model_reference"
            ;;
        codex)
            if [[ "$SOURCE_TYPE" == "ollama" ]]; then
                exec env "OLLAMA_HOST=${HOST}:${PORT}" \
                    "$executable" "${args[@]}" --oss --local-provider ollama --model "$MODEL"
            fi
            local provider_id="local_${PROVIDER}"
            local quoted_name="$("$JQ_BIN" -Rn --arg value "$SOURCE_NAME" '$value')"
            local quoted_url="$("$JQ_BIN" -Rn --arg value "$BASE_URL" '$value')"
            exec "$executable" "${args[@]}" --model "$MODEL" \
                -c "model_provider=$provider_id" \
                -c "model_providers.${provider_id}.name=$quoted_name" \
                -c "model_providers.${provider_id}.base_url=$quoted_url" \
                -c "model_providers.${provider_id}.wire_api=\"responses\"" \
                -c "model_providers.${provider_id}.requires_openai_auth=false"
            ;;
        claude)
            exec env \
                "ANTHROPIC_BASE_URL=$BASE_URL" \
                "ANTHROPIC_AUTH_TOKEN=not-needed" \
                "LOCAL_AI_SOURCE=$ACTIVE_SOURCE" \
                "LOCAL_AI_PROVIDER=$PROVIDER" \
                "LOCAL_AI_MODEL=$MODEL" \
                "LOCAL_AI_BASE_URL=$BASE_URL" \
                "$executable" "${args[@]}" --model "$MODEL"
            ;;
        generic)
            exec env \
                "OPENAI_BASE_URL=$BASE_URL" \
                "OPENAI_API_BASE=$BASE_URL" \
                "OPENAI_API_KEY=not-needed" \
                "LOCAL_AI_SOURCE=$ACTIVE_SOURCE" \
                "LOCAL_AI_PROVIDER=$PROVIDER" \
                "LOCAL_AI_MODEL=$MODEL" \
                "LOCAL_AI_BASE_URL=$BASE_URL" \
                "$executable" "${args[@]}"
            ;;
    esac
}

stop_source() {
    local state_file="$(pid_file)"
    if [[ ! -f "$state_file" ]]; then
        if health_ok; then
            ui_warn "$SOURCE_NAME laeuft extern und wird deshalb nicht beendet"
        else
            ui_ok "$SOURCE_NAME ist bereits gestoppt"
        fi
        return 0
    fi

    local source_pid="$(<"$state_file")"
    if [[ "$source_pid" != <-> ]] || ! kill -0 "$source_pid" 2>/dev/null; then
        rm -f "$state_file"
        ui_ok "$SOURCE_NAME ist bereits gestoppt"
        return 0
    fi

    ui_step "Stoppe $SOURCE_NAME"
    kill "$source_pid" 2>/dev/null || true
    local attempt=0
    while kill -0 "$source_pid" 2>/dev/null && (( attempt < 20 )); do
        sleep 0.25
        (( attempt += 1 ))
    done
    kill -0 "$source_pid" 2>/dev/null && fail "$SOURCE_NAME konnte nicht beendet werden."
    rm -f "$state_file"
    log "$SOURCE_NAME wurde gestoppt."
    ui_ok "$SOURCE_NAME wurde gestoppt"
}

show_status() {
    show_dashboard
    printf '%sCONFIG%s  %s\n' "$C_DIM" "$C_RESET" "$CONFIG_FILE"
    if source_ready; then
        ui_ok "API und konfiguriertes Modell sind bereit"
    elif health_ok; then
        ui_warn "API ist erreichbar, aber Modell oder Providerprozess passen nicht zur Konfiguration"
    else
        ui_warn "API ist nicht erreichbar"
    fi
}

check_configuration() {
    show_dashboard
    local warnings=0
    ui_ok "Konfiguration ist gueltig"

    if [[ "$SOURCE_TYPE" == "mlx" || "$SOURCE_TYPE" == "ollama" ]]; then
        local configured_command="$(source_value server_command 2>/dev/null || true)"
        if [[ -z "$(resolve_executable "$configured_command" 2>/dev/null || true)" ]]; then
            ui_warn "Provider-Befehl fehlt: $configured_command"
            (( warnings += 1 ))
        else
            ui_ok "Provider-Befehl gefunden"
        fi
    fi

    if [[ -z "$(resolve_executable "$FRAMEWORK_COMMAND" 2>/dev/null || true)" ]]; then
        ui_warn "Framework-Befehl fehlt: $FRAMEWORK_COMMAND"
        (( warnings += 1 ))
    else
        ui_ok "Framework-Befehl gefunden"
    fi

    check_framework_compatibility
    (( warnings == 0 ))
}

choose_profile() {
    local group="$1"
    local current="$2"
    local label="$3"
    local -a keys
    keys=("${(@f)$("$JQ_BIN" -r ".${group} | keys[]" "$CONFIG_FILE")}")

    printf '\n%s waehlen:\n' "$label"
    local index
    for index in {1..${#keys}}; do
        local marker=" "
        local profile_name="$("$JQ_BIN" -r --arg profile "$keys[$index]" ".${group}[\$profile].name" "$CONFIG_FILE")"
        [[ "$keys[$index]" == "$current" ]] && marker="•"
        printf '  %d) %s %s  %s[%s]%s\n' "$index" "$marker" "$profile_name" "$C_DIM" "$keys[$index]" "$C_RESET"
    done
    printf 'Auswahl [aktuell]: '
    local selection
    read -r selection
    if [[ -z "$selection" ]]; then
        CHOSEN_PROFILE="$current"
        return 0
    fi
    [[ "$selection" == <-> ]] || return 1
    (( selection >= 1 && selection <= ${#keys} )) || return 1
    CHOSEN_PROFILE="$keys[$selection]"
}

setup_configuration() {
    show_dashboard
    choose_profile providers "$ACTIVE_SOURCE" Provider || fail "Ungueltige Providerauswahl."
    local selected_source="$CHOSEN_PROFILE"
    choose_profile frameworks "$ACTIVE_FRAMEWORK" Framework || fail "Ungueltige Framework-Auswahl."
    local selected_framework="$CHOSEN_PROFILE"
    local current_model="$MODEL"
    if [[ "$selected_source" != "$ACTIVE_SOURCE" ]]; then
        current_model="$("$JQ_BIN" -r --arg profile "$selected_source" '.providers[$profile].default_model // .model' "$CONFIG_FILE")"
    fi
    local selected_type="$("$JQ_BIN" -r --arg profile "$selected_source" '.providers[$profile].type' "$CONFIG_FILE")"
    local selected_protocol="$("$JQ_BIN" -r --arg profile "$selected_source" '.providers[$profile].protocol' "$CONFIG_FILE")"
    local selected_adapter="$("$JQ_BIN" -r --arg profile "$selected_framework" '.frameworks[$profile].adapter' "$CONFIG_FILE")"
    local selected_source_name="$("$JQ_BIN" -r --arg profile "$selected_source" '.providers[$profile].name' "$CONFIG_FILE")"
    local selected_framework_name="$("$JQ_BIN" -r --arg profile "$selected_framework" '.frameworks[$profile].name' "$CONFIG_FILE")"

    if ! profiles_are_compatible "$selected_adapter" "$selected_type" "$selected_protocol"; then
        fail "$selected_framework_name und $selected_source_name sind wegen des API-Protokolls '$selected_protocol' nicht direkt kompatibel."
    fi

    printf '\nModell-ID [%s]: ' "$current_model"
    local selected_model
    read -r selected_model
    selected_model="${selected_model:-$current_model}"
    [[ -n "$selected_model" ]] || fail "Modell-ID darf nicht leer sein."

    local temp_file="$(mktemp "${CONFIG_FILE}.XXXXXX")" || fail "Temporaere Datei konnte nicht angelegt werden."
    "$JQ_BIN" \
        --arg source "$selected_source" \
        --arg framework "$selected_framework" \
        --arg model "$selected_model" \
        '.provider = $source |
         .framework = $framework |
         .model = $model |
         .providers[$source].default_model = $model' \
        "$CONFIG_FILE" > "$temp_file" || fail "Konfiguration konnte nicht gespeichert werden."
    mv "$temp_file" "$CONFIG_FILE"

    load_config
    printf '\n'
    ui_ok "Profil gespeichert"
    show_dashboard
    check_framework_compatibility
    printf 'Beim naechsten Doppelklick startet genau Provider → Modell → Framework aus der Konfiguration.\n'
}

show_help() {
    cat <<'EOF'
Verwendung: Local Dev.command [Aktion]

Ohne Argument       Provider starten, Modell laden und Framework oeffnen
--setup              Provider, Modell und Framework konfigurieren
--start-only         Aktiven Provider ohne Framework starten
--stop               Vom Starter gestarteten Provider stoppen
--status             Auswahl und Erreichbarkeit anzeigen
--check              Installation und Kompatibilitaet pruefen
--config-path        Pfad der lokalen Konfiguration ausgeben
--render-opencode-config
                     Generierte OpenCode-Konfiguration ausgeben
--help               Diese Hilfe anzeigen
EOF
}

main() {
    init_ui
    local action="${1:-start}"
    load_config

    case "$action" in
        start|--start)
            show_dashboard
            check_framework_compatibility
            start_source
            launch_framework
            ;;
        --start-only)
            show_dashboard
            start_source
            ;;
        --stop)
            show_dashboard
            stop_source
            ;;
        --status)
            show_status
            ;;
        --check)
            check_configuration
            ;;
        --setup)
            setup_configuration
            ;;
        --config-path)
            printf '%s\n' "$CONFIG_FILE"
            ;;
        --render-opencode-config)
            render_opencode_config
            ;;
        --help|-h)
            show_help
            ;;
        *)
            show_help
            fail "Unbekannte Aktion: $action"
            ;;
    esac
}

main "$@"
