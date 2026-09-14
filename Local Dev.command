#!/bin/zsh

# =============================================
# Local Dev - KI Provider Manager
# Verwalte lokal gehostete KI-Modelle mit Providern
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
LOCAL_DEV_DIR="${SCRIPT_DIR}/local-dev"
CONFIG_FILE="${LOCAL_DEV_DIR}/mlx-config.json"
LOCK_FILE="${LOCAL_DEV_DIR}/.mlx-spark.lock"
LOG_FILE="${LOCAL_DEV_DIR}/mlx-spark.log"
BACKEND="MLX"  # Standard-Backend (kann in Zukunft erweitert werden)
OPENCODE_NPM_PREFIX="$HOME/.npm-global"
export PATH="${OPENCODE_NPM_PREFIX}:${HOME}/.local/bin:${HOME}/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Logging
log() {
    echo "[$(date +'%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check dependencies
check_python() {
    if ! command -v python3 &> /dev/null; then
        echo "Python3 ist nicht installiert!"
        echo "Installiere Python3: brew install python"
        echo -n "Druecke Enter zum Beenden..."
        read -r
        exit 1
    fi
}

add_opencode_path() {
    local path_line='export PATH="$HOME/.npm-global:$HOME/.local/bin:$HOME/.opencode/bin:$PATH"'
    local shell_profile="$HOME/.zprofile"

    if ! grep -Fqx "$path_line" "$shell_profile" 2>/dev/null; then
        printf '\n# OpenCode CLI\n%s\n' "$path_line" >> "$shell_profile"
    fi
    export PATH="${OPENCODE_NPM_PREFIX}:${HOME}/.local/bin:${HOME}/.opencode/bin:${PATH}"
}

install_opencode() {
    if ! command -v npm &> /dev/null; then
        echo "npm wurde nicht gefunden. Bitte zuerst Node.js installieren (z. B. brew install node)."
        return 1
    fi

    mkdir -p "$OPENCODE_NPM_PREFIX"
    npm config set prefix "$OPENCODE_NPM_PREFIX" >/dev/null 2>&1
    add_opencode_path
    echo "Installiere OpenCode CLI fuer deinen Benutzer..."
    npm install --global opencode-ai
}

check_opencode() {
    if command -v opencode &> /dev/null || [ -d "/Applications/OpenCode.app" ] || [ -d "$HOME/Applications/OpenCode.app" ]; then
        return 0
    fi

    echo "OpenCode ist noch nicht installiert."
    echo -n "Jetzt automatisch installieren? (ja/nein): "
    read -r
    if [[ $REPLY =~ ^[Jj][Aa]?$ ]]; then
        install_opencode || exit 1
        if ! command -v opencode &> /dev/null; then
            echo "OpenCode wurde installiert, aber die CLI ist noch nicht im PATH sichtbar."
            echo "Starte ein neues Terminal und fuehre das Programm erneut aus."
            exit 1
        fi
        return 0
    fi

    echo "OpenCode wird benoetigt. Installiere es spaeter ueber das Setup."
    exit 1
}

# Get config values
get_model() {
    if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
        grep '"model"' "$CONFIG_FILE" | sed 's/.*: *"//;s/".*//' | head -n1
    else
        echo "Spark-X2.5-4B"
    fi
}

get_repo() {
    if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
        grep '"repository"' "$CONFIG_FILE" | sed 's/.*: *"//;s/".*//' | head -n1
    else
        echo "XHToken/Spark-X2.5-4B"
    fi
}

get_port() {
    if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
        grep '"port"' "$CONFIG_FILE" | sed 's/.*: *//;s/[^0-9].*//' | head -n1
    else
        echo "8000"
    fi
}

get_device() {
    if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
        grep '"device"' "$CONFIG_FILE" | sed 's/.*: *"//;s/".*//' | head -n1
    else
        echo "gpu"
    fi
}

get_dtype() {
    if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
        grep '"dtype"' "$CONFIG_FILE" | sed 's/.*: *"//;s/".*//' | head -n1
    else
        echo "bfloat16"
    fi
}

# Get provider name (flexibel aus Config oder Default)
get_provider_name() {
    if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
        local name
        name=$(grep '"provider_name"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*: *"//;s/".*//' | head -n1)
        if [ -n "$name" ]; then
            echo "$name"
            return
        fi
        name=$(grep '"name"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*: *"//;s/".*//' | head -n1)
        if [ -n "$name" ]; then
            echo "$name"
            return
        fi
    fi
    echo "$BACKEND $(get_model)"
}

get_opencode_model() {
    echo "mlx/$(get_model)"
}

get_opencode_config() {
    local model="$(get_model)"
    local port="$(get_port)"
    echo "{\"provider\":{\"mlx\":{\"npm\":\"@ai-sdk/openai-compatible\",\"name\":\"MLX local\",\"options\":{\"baseURL\":\"http://localhost:${port}/v1\"},\"models\":{\"${model}\":{\"name\":\"${model}\"}}}},\"model\":\"$(get_opencode_model)\"}"
}

# Open OpenCode in Vordergrund mit lokalem Modell
open_opencode() {
    local model="$(get_model)"
    local provider_name="$(get_provider_name)"
    local opencode_model="$(get_opencode_model)"
    
    if pgrep -if "opencode" > /dev/null 2>&1; then
        osascript -e 'tell application "OpenCode" to activate' 2>/dev/null
        log "OpenCode ist bereits offen und im Vordergrund"
        return 0
    fi
    
    log "Oeffne OpenCode mit $provider_name ($model) und bringe in Vordergrund..."
    
    # App bevorzugen, sonst CLI in einem neuen Terminalfenster starten
    if [ -d "/Applications/OpenCode.app" ] || [ -d "$HOME/Applications/OpenCode.app" ]; then
        open -a "OpenCode" --args --model "$opencode_model" > /dev/null 2>&1 &
    elif command -v opencode &> /dev/null; then
        local opencode_config="$(get_opencode_config)"
        osascript <<APPLESCRIPT >/dev/null 2>&1
tell application "Terminal"
    activate
    do script "OPENCODE_CONFIG_CONTENT='${opencode_config}' opencode --model '${opencode_model}'; echo; echo 'OpenCode beendet. Dieses Terminal bleibt fuer weitere Befehle offen.'; exec zsh -l"
end tell
APPLESCRIPT
    else
        log "ERROR: Keine OpenCode App oder CLI gefunden"
        return 1
    fi
    
    sleep 3
    osascript -e 'tell application "OpenCode" to activate' 2>/dev/null
    sleep 2
    
    if ! pgrep -if "opencode" > /dev/null 2>&1; then
        log "WARNING: OpenCode konnte nicht geoeffnet werden"
        return 1
    fi
    
    log "OpenCode im Vordergrund mit $provider_name ($model)"
    return 0
}

# Start MLX Server
start_mlx() {
    local provider_name="$(get_provider_name)"
    local model="$(get_model)"
    
    check_python
    check_opencode
    
    if [ -f "$LOCK_FILE" ]; then
        if pgrep -f "mlx_lm.server" > /dev/null 2>&1; then
            log "$provider_name Server laeuft bereits"
            configure_opencode
            open_opencode
            return 0
        fi
    fi
    
    if [ ! -d "$HOME/Spark-MLX-LLM" ]; then
        echo "Spark-MLX-LLM ist nicht installiert!"
        echo -n "Jetzt installieren? (ja/nein): "
        read -r
        if [[ $REPLY =~ ^[Jj][Aa]?$ ]]; then
            log "Installiere Spark-MLX-LLM..."
            cd ~
            git clone https://github.com/XHToken/Spark-MLX-LLM.git ~/Spark-MLX-LLM 2>> "$LOG_FILE"
            cd ~/Spark-MLX-LLM
            python3 -m venv .venv 2>> "$LOG_FILE"
            source .venv/bin/activate
            pip install -e . 2>> "$LOG_FILE"
            deactivate
            echo "Spark-MLX-LLM installiert!"
        else
            return 1
        fi
    fi
    
    local PORT="$(get_port)"
    local REPO="$(get_repo)"
    
    log "Starte $provider_name Server mit $model auf Port $PORT..."
    
    cd ~/Spark-MLX-LLM
    source .venv/bin/activate
    nohup mlx_lm.server --model "$REPO" --port $PORT >> "$LOG_FILE" 2>&1 &
    sleep 5
    
    if ! pgrep -f "mlx_lm.server" > /dev/null 2>&1; then
        log "ERROR: $provider_name Server konnte nicht gestartet werden!"
        echo "Pruefe: $LOG_FILE"
        return 1
    fi
    
    touch "$LOCK_FILE"
    configure_opencode
    
    # Schließe OpenCode, falls offen, um mit neuer Konfiguration zu starten
    if pgrep -if "opencode" > /dev/null 2>&1; then
        log "Schließe OpenCode für Neuladen der Konfiguration..."
        pkill -f "OpenCode" 2>/dev/null
        pkill -f "opencode" 2>/dev/null
        sleep 2
    fi
    
    open_opencode
    
    log "$provider_name Server gestartet!"
    echo ""
    return 0
}

# Stop MLX Server + OpenCode
stop_mlx() {
    local provider_name="$(get_provider_name)"
    local model="$(get_model)"
    local port="$(get_port)"
    
    # Stoppe MLX Server
    if pgrep -f "mlx_lm.server" > /dev/null 2>&1; then
        log "Stoppe $provider_name Server..."
        pkill -f "mlx_lm.server" 2>/dev/null
        sleep 2
        if pgrep -f "mlx_lm.server" > /dev/null 2>&1; then
            pkill -9 -f "mlx_lm.server" 2>/dev/null
            sleep 1
        fi
    else
        log "$provider_name Server laeuft nicht"
    fi
    
    # Stoppe OpenCode (macOS App richtig beenden)
    if pgrep -if "opencode" > /dev/null 2>&1; then
        log "Stoppe OpenCode..."
        osascript -e 'tell application "OpenCode" to quit' 2>/dev/null
        sleep 2
        # Falls osascript nicht funktioniert, pkill als Fallback
        if pgrep -f "OpenCode" > /dev/null 2>&1; then
            pkill -f "OpenCode" 2>/dev/null
            sleep 1
        fi
    fi
    
    rm -f "$LOCK_FILE"
    log "Alles gestoppt: $provider_name + OpenCode"
    echo ""
    echo "=========================================="
    echo "  Provider:  $provider_name"
    echo "  Framework: OpenCode"
    echo "  KI-Modell: $model"
    echo "  Server:    http://localhost:$port"
    echo "  Status:    GESTOPPT"
    echo "=========================================="
    echo ""
    return 0
}

# Configure OpenCode via CLI
configure_opencode() {
    local port="$(get_port)"
    local model="$(get_model)"
    local provider_name="$(get_provider_name)"
    
    log "Konfiguriere OpenCode CLI fuer $provider_name..."
    
    # Provider hinzufuegen oder aktualisieren
    if opencode providers list 2>/dev/null | grep -q "$provider_name"; then
        # Provider existiert bereits - aktualisieren
        opencode providers update "$provider_name" \
            --url "http://localhost:$port" \
            --api-key "not-needed" 2>/dev/null
    else
        # Provider neu hinzufuegen
        opencode providers add "$provider_name" \
            --url "http://localhost:$port" \
            --api-key "not-needed" 2>/dev/null
    fi
    
    # Modell dem Provider hinzufuegen
    opencode providers models add "$provider_name" "$model" 2>/dev/null
    
    # Als Standard setzen
    opencode settings set defaultProvider "$provider_name" 2>/dev/null
    opencode settings set defaultModel "$model" 2>/dev/null
    
    # Provider aktivieren
    opencode providers enable "$provider_name" 2>/dev/null
    
    log "OpenCode fuer $provider_name konfiguriert (Standard: $model)"
}

# Check if running
is_running() {
    [ -f "$LOCK_FILE" ] && pgrep -f "mlx_lm.server" > /dev/null 2>&1
}

# Get backend display name (flexibel) - verwendet Provider-Name
get_backend_display() {
    get_provider_name
}

# Setup config
setup_config() {
    local provider_name="$(get_provider_name)"
    local model="$(get_model)"
    
    echo ""
    echo "=========================================="
    echo "  Provider:  $provider_name"
    echo "  Framework: OpenCode"
    echo "  Aktuelle KI: $model"
    echo "=========================================="
    echo ""
    echo "$provider_name - Konfiguration anpassen"
    echo ""
    
    local model="Spark-X2.5-4B"
    local repo="XHToken/Spark-X2.5-4B"
    local port="8000"
    local device="gpu"
    local dtype="bfloat16"
    
    echo "Aktuelle Einstellungen:"
    echo "  Modell: $model"
    echo "  Repository: $repo"
    echo "  Port: $port"
    echo "  Device: $device"
    echo "  Dtype: $dtype"
    echo ""
    
    echo "Moechtest du Aenderungen vornehmen? (ja/nein):"
    echo -n " > "
    read -r
    
    if [[ $REPLY =~ ^[Jj][Aa]?$ ]]; then
        echo ""
        echo "Lass leer fuer Standardwert"
        echo ""
        echo -n "Modell [Spark-X2.5-4B]: "
        read -r
        model="${REPLY:-Spark-X2.5-4B}"
        
        echo -n "Repository [XHToken/Spark-X2.5-4B]: "
        read -r
        repo="${REPLY:-XHToken/Spark-X2.5-4B}"
        
        echo -n "Port [8000]: "
        read -r
        port="${REPLY:-8000}"
        
        echo -n "Device [gpu/cpu] [gpu]: "
        read -r
        device="${REPLY:-gpu}"
        
        echo -n "Dtype [bfloat16/float16] [bfloat16]: "
        read -r
        dtype="${REPLY:-bfloat16}"
    fi
    
    # Provider Name
    echo -n "Provider Name [$model] (optional): "
    read -r
    local provider_input="${REPLY:-}"
    
    cat > "$CONFIG_FILE" << EOF
{
  "mlx": {
    "model": "$model",
    "repository": "$repo",
    "device": "$device",
    "dtype": "$dtype",
    "port": $port
  },
  "provider_name": "${provider_input:-$model}"
}
EOF
    
    echo ""
    log "Konfiguration gespeichert"
    echo "=========================================="
    echo "  Provider:  ${provider_input:-$model}"
    echo "  Framework: OpenCode"
    echo "  Neue KI:   $model"
    echo "  Repository: $repo"
    echo "  Port:       $port"
    echo "  Device:     $device"
    echo "  Dtype:      $dtype"
    echo "=========================================="
    echo ""
}

# Main menu
show_menu() {
    local provider_name="$(get_provider_name)"
    local model="$(get_model)"
    
    while true; do
        echo ""
        echo "=========================================="
        echo "  Local Dev - KI Provider Manager"
        echo "=========================================="
        echo ""
        echo "  Provider:  $provider_name"
        echo "  Framework: OpenCode"
        echo "  KI-Modell:  $model"
        
        if is_running; then
            echo "  Status:     LAEUFT [Port: $(get_port)]"
        else
            echo "  Status:     GESTOPPT"
        fi
        
        echo ""
        echo "=========================================="
        echo "  Verfuegbare Aktionen:"
        echo "=========================================="
        echo ""
        echo "  1) Provider starten    - $provider_name Server + OpenCode starten"
        echo "  2) Provider stoppen    - $provider_name Server + OpenCode beenden"
        echo "  3) Provider anpassen   - KI/Provider Einstellungen"
        echo "  4) Beenden            - Skript schliessen"
        echo ""
        echo -n "  Wahl (1-4): "
        read -r
        echo ""
        
        case $REPLY in
            1)
                if ! is_running; then
                    start_mlx
                else
                    echo "$provider_name Server laeuft bereits!"
                    open_opencode
                fi
                ;;
            2)
                if is_running; then
                    stop_mlx
                else
                    echo "$provider_name Server ist bereits gestoppt!"
                fi
                ;;
            3)
                setup_config
                ;;
            4)
                log "Skript beendet"
                exit 0
                ;;
            *)
                echo "Ungueltige Auswahl!"
                ;;
        esac
    done
}

# Main
main() {
    # Check local-dev directory
    if [ ! -d "$LOCAL_DEV_DIR" ]; then
        echo "local-dev Verzeichnis nicht gefunden!"
        exit 1
    fi
    
    # Create log file
    touch "$LOG_FILE"
    
    # Create default config if not exists
    if [ ! -f "$CONFIG_FILE" ] || [ ! -s "$CONFIG_FILE" ]; then
        cat > "$CONFIG_FILE" << EOF
{
  "mlx": {
    "model": "Spark-X2.5-4B",
    "repository": "XHToken/Spark-X2.5-4B",
    "device": "gpu",
    "dtype": "bfloat16",
    "port": 8000
  },
  "provider_name": "MLX Spark-X2.5-4B"
}
EOF
        log "Standardkonfiguration erstellt"
    fi
    
    # Auto-Start: Wenn nichts laeuft, direkt starten
    if ! is_running; then
        local provider_name="$(get_provider_name)"
        log "Auto-Start: $provider_name wird automatisch gestartet..."
        start_mlx
        # Nach dem Start: Zeige Menü für weitere Aktionen
        show_menu
    else
        # Wenn schon laeuft: Zeige Menü
        show_menu
    fi
}

main
exit 0
