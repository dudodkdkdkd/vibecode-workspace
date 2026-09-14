#!/bin/zsh

# Local Dev - Ollama + MLX + OpenCode Manager
# Ein Skript fuer ALLES: Setup, Start/Stop, Reset
# Unterstuetzt Ollama UND MLX fuer Spark-Modelle

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
LOCAL_DEV_DIR="${SCRIPT_DIR}/local-dev"
CONFIG_FILE="${LOCAL_DEV_DIR}/ollama-config.json"
MLX_CONFIG_FILE="${LOCAL_DEV_DIR}/mlx-config.json"
LOCK_FILE="${LOCAL_DEV_DIR}/.ollama-opencode.lock"
MLX_LOCK_FILE="${LOCAL_DEV_DIR}/.mlx-spark.lock"
LOG_FILE="${LOCAL_DEV_DIR}/local-dev.log"
MLX_LOG_FILE="${LOCAL_DEV_DIR}/mlx-spark.log"
OPENCODE_NPM_PREFIX="$HOME/.npm-global"
export PATH="${OPENCODE_NPM_PREFIX}:${HOME}/.local/bin:${HOME}/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Logging
log() {
    echo "[$(date +'%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

mlx_log() {
    echo "[$(date +'%H:%M:%S')] $1" | tee -a "$MLX_LOG_FILE"
}

check_local_dev() {
    if [ ! -d "$LOCAL_DEV_DIR" ]; then
        echo "ERROR: local-dev Verzeichnis nicht gefunden!"
        echo "   Erwartet: ${LOCAL_DEV_DIR}"
        exit 1
    fi
}

check_ollama() {
    if ! command -v ollama &> /dev/null; then
        echo "Ollama ist nicht installiert!"
        echo "   Installiere Ollama: curl -fsSL https://ollama.com/install.sh | sh"
        echo -n "Druecke Enter zum Beenden..."
        read -r
        exit 1
    fi
}

check_python() {
    if ! command -v python3 &> /dev/null; then
        echo "Python3 ist nicht installiert!"
        echo "   Installiere Python3: brew install python"
        echo -n "Druecke Enter zum Beenden..."
        read -r
        exit 1
    fi
}

check_opencode() {
    if command -v opencode &> /dev/null || [ -d "/Applications/OpenCode.app" ] || [ -d "$HOME/Applications/OpenCode.app" ]; then
        return 0
    fi

    echo "OpenCode ist noch nicht installiert."
    echo -n "Jetzt automatisch installieren? (ja/nein): "
    read -r
    if [[ $REPLY =~ ^[Jj][Aa]?$ ]]; then
        if ! command -v npm &> /dev/null; then
            echo "npm wurde nicht gefunden. Bitte zuerst Node.js installieren (z. B. brew install node)."
            exit 1
        fi
        mkdir -p "$OPENCODE_NPM_PREFIX"
        npm config set prefix "$OPENCODE_NPM_PREFIX" >/dev/null 2>&1
        local path_line='export PATH="$HOME/.npm-global:$HOME/.local/bin:$HOME/.opencode/bin:$PATH"'
        if ! grep -Fqx "$path_line" "$HOME/.zprofile" 2>/dev/null; then
            printf '\n# OpenCode CLI\n%s\n' "$path_line" >> "$HOME/.zprofile"
        fi
        export PATH="${OPENCODE_NPM_PREFIX}:${HOME}/.local/bin:${HOME}/.opencode/bin:${PATH}"
        echo "Installiere OpenCode CLI fuer deinen Benutzer..."
        npm install --global opencode-ai || exit 1
        command -v opencode &> /dev/null || {
            echo "OpenCode wurde installiert, aber die CLI ist noch nicht im PATH sichtbar."
            echo "Starte ein neues Terminal und fuehre das Programm erneut aus."
            exit 1
        }
        return 0
    fi

    echo "OpenCode wird benoetigt. Installiere es spaeter ueber das Setup."
    exit 1
}

get_model() {
    if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
        grep '"model"' "$CONFIG_FILE" | sed 's/.*: *"//;s/".*//' | head -n1
    else
        echo "deepseek-coder:6.7b"
    fi
}

get_opencode_model() {
    local provider="$1"
    local model="$2"
    echo "${provider}/${model}"
}

get_opencode_config() {
    local provider="$1"
    local model="$2"
    local port="$3"
    local provider_name="${provider} (local)"
    echo "{\"provider\":{\"${provider}\":{\"npm\":\"@ai-sdk/openai-compatible\",\"name\":\"${provider_name}\",\"options\":{\"baseURL\":\"http://localhost:${port}/v1\"},\"models\":{\"${model}\":{\"name\":\"${model}\"}}}},\"model\":\"$(get_opencode_model "$provider" "$model")\"}"
}

get_mlx_model() {
    if [ -f "$MLX_CONFIG_FILE" ] && [ -s "$MLX_CONFIG_FILE" ]; then
        grep '"model"' "$MLX_CONFIG_FILE" | sed 's/.*: *"//;s/".*//' | head -n1
    else
        echo "Spark-X2.5-4B"
    fi
}

get_mlx_repo() {
    if [ -f "$MLX_CONFIG_FILE" ] && [ -s "$MLX_CONFIG_FILE" ]; then
        grep '"repository"' "$MLX_CONFIG_FILE" | sed 's/.*: *"//;s/".*//' | head -n1
    else
        echo "XHToken/Spark-X2.5-4B"
    fi
}

get_mlx_port() {
    if [ -f "$MLX_CONFIG_FILE" ] && [ -s "$MLX_CONFIG_FILE" ]; then
        grep '"port"' "$MLX_CONFIG_FILE" | sed 's/.*: *//;s/[^0-9].*//' | head -n1
    else
        echo "8000"
    fi
}

# Ollama Functions
start_ollama() {
    if pgrep -x "ollama" > /dev/null 2>&1; then
        log "Ollama laeuft bereits"
        return 0
    fi
    log "Starte Ollama..."
    ollama serve > /dev/null 2>&1 &
    sleep 3
    if ! pgrep -x "ollama" > /dev/null 2>&1; then
        log "ERROR: Ollama konnte nicht gestartet werden!"
        return 1
    fi
    log "Ollama gestartet auf Port 11434"
    return 0
}

stop_ollama() {
    if ! pgrep -x "ollama" > /dev/null 2>&1; then
        log "Ollama laeuft nicht"
        return 0
    fi
    log "Stoppe Ollama..."
    pkill -x "ollama" 2>/dev/null
    sleep 2
    if pgrep -x "ollama" > /dev/null 2>&1; then
        log "ERROR: Ollama konnte nicht gestoppt werden!"
        return 1
    fi
    log "Ollama gestoppt"
    return 0
}

pull_model() {
    local model="$1"
    if ollama list | grep -q "$model"; then
        log "Modell '$model' ist bereits vorhanden"
        return 0
    fi
    log "Lade Modell '$model'..."
    if ollama pull "$model" >> "$LOG_FILE" 2>&1; then
        log "Modell '$model' geladen"
        return 0
    else
        log "ERROR: Modell '$model' konnte nicht geladen werden!"
        echo "Das konfigurierte Ollama-Modell '$model' ist nicht verfuegbar."
        echo "Pruefe den Modellnamen mit: ollama list"
        echo "Passe ihn in local-dev/ollama-config.json an oder installiere es mit: ollama pull '$model'"
        return 1
    fi
}

remove_model() {
    local model="$1"
    if ! ollama list | grep -q "$model"; then
        log "Modell '$model' ist nicht geladen"
        return 0
    fi
    log "Entferne Modell '$model'..."
    if ollama rm "$model" >> "$LOG_FILE" 2>&1; then
        log "Modell '$model' entfernt"
        return 0
    else
        log "ERROR: Modell '$model' konnte nicht entfernt werden!"
        return 1
    fi
}

configure_opencode_ollama() {
    local config_dir="$HOME/Library/Application Support/OpenCode/User"
    local settings_file="$config_dir/settings.json"
    mkdir -p "$config_dir"
    if [ -f "$settings_file" ]; then
        cp "$settings_file" "$settings_file.bak"
    fi
    cat > "$settings_file" << EOF
{
  "providers": [
    {
      "name": "Ollama",
      "baseUrl": "http://localhost:11434",
      "apiKey": "not-needed",
      "enabled": true,
      "defaultModel": "$(get_model)"
    }
  ],
  "ollama.baseUrl": "http://localhost:11434",
  "ollama.enabled": true,
  "ollama.defaultModel": "$(get_model)"
}
EOF
    log "OpenCode fuer Ollama konfiguriert"
}

start_opencode() {
    local provider="${1:-ollama}"
    local model="${2:-$(get_model)}"
    local port="${3:-11434}"
    local opencode_model="$(get_opencode_model "$provider" "$model")"
    if pgrep -if "opencode" > /dev/null 2>&1; then
        log "OpenCode laeuft bereits"
        return 0
    fi
    log "Starte OpenCode..."
    if [ -d "/Applications/OpenCode.app" ] || [ -d "$HOME/Applications/OpenCode.app" ]; then
        open -a "OpenCode" --args --user-data-dir="$HOME/Library/Application Support/OpenCode" --model "$opencode_model" > /dev/null 2>&1 &
    elif command -v opencode &> /dev/null; then
        local opencode_config="$(get_opencode_config "$provider" "$model" "$port")"
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
    sleep 2
    if ! pgrep -if "opencode" > /dev/null 2>&1; then
        log "ERROR: OpenCode konnte nicht gestartet werden!"
        return 1
    fi
    log "OpenCode gestartet"
    return 0
}

stop_opencode() {
    if ! pgrep -if "opencode" > /dev/null 2>&1; then
        log "OpenCode laeuft nicht"
        return 0
    fi
    log "Stoppe OpenCode..."
    pkill -f "OpenCode" 2>/dev/null
    pkill -f "opencode" 2>/dev/null
    sleep 2
    if pgrep -if "opencode" > /dev/null 2>&1; then
        killall "OpenCode" 2>/dev/null
        killall "opencode" 2>/dev/null
        sleep 1
    fi
    if pgrep -if "opencode" > /dev/null 2>&1; then
        log "OpenCode konnte nicht vollstaendig gestoppt werden"
        return 1
    fi
    log "OpenCode gestoppt"
    return 0
}

is_ollama_running() {
    [ -f "$LOCK_FILE" ] && pgrep -x "ollama" > /dev/null 2>&1
}

# MLX Functions
setup_mlx() {
    echo ""
    echo "Installiere Spark-MLX-LLM..."
    echo ""
    if [ -d "$HOME/Spark-MLX-LLM" ]; then
        echo "Spark-MLX-LLM ist bereits installiert"
        echo ""
        return 0
    fi
    if ! git clone https://github.com/XHToken/Spark-MLX-LLM.git "$HOME/Spark-MLX-LLM" >> "$MLX_LOG_FILE" 2>&1; then
        mlx_log "ERROR: Spark-MLX-LLM Repository konnte nicht geklont werden!"
        echo "Installation fehlgeschlagen!"
        echo -n "Druecke Enter zum Fortfahren..."
        read -r
        return 1
    fi
    cd "$HOME/Spark-MLX-LLM" || return 1
    echo "Erstelle Python Virtual Environment..."
    python3 -m venv .venv >> "$MLX_LOG_FILE" 2>&1
    echo "Installiere Abhaengigkeiten..."
    source .venv/bin/activate
    python -m pip install -e . >> "$MLX_LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
        mlx_log "ERROR: Abhaengigkeiten konnten nicht installiert werden!"
        echo "Installation fehlgeschlagen!"
        echo -n "Druecke Enter zum Fortfahren..."
        read -r
        return 1
    fi
    deactivate
    echo ""
    mlx_log "Spark-MLX-LLM erfolgreich installiert"
    echo "Installation abgeschlossen!"
    echo ""
    return 0
}

start_mlx_spark() {
    if ! check_python; then
        return 1
    fi
    if [ ! -d "$HOME/Spark-MLX-LLM" ]; then
        echo "Spark-MLX-LLM muss zuerst installiert werden!"
        echo -n "Jetzt installieren\? (ja/nein): "
        read -r
        if [[ $REPLY =~ ^[Jj][Aa]?$ ]]; then
            setup_mlx || return 1
        else
            return 1
        fi
    fi
    if [ -f "$MLX_LOCK_FILE" ]; then
        if pgrep -f "spark-mlx-serve" > /dev/null 2>&1; then
            mlx_log "MLX Server laeuft bereits"
            return 0
        fi
    fi
    local MLX_PORT="$(get_mlx_port)"
    local MLX_REPO="$(get_mlx_repo)"
    mlx_log "Starte MLX Server mit $(get_mlx_model)..."
    local SERVER_SCRIPT="$LOCAL_DEV_DIR/mlx-server.sh"
    cat > "$SERVER_SCRIPT" << SERVEREOF
#!/bin/zsh
cd \$HOME/Spark-MLX-LLM
source .venv/bin/activate
spark-mlx-serve --device gpu --dtype bfloat16 --model ${MLX_REPO} --port ${MLX_PORT}
SERVEREOF
    chmod +x "$SERVER_SCRIPT"
    nohup /bin/zsh "$SERVER_SCRIPT" >> "$MLX_LOG_FILE" 2>&1 &
    sleep 5
    if ! pgrep -f "spark-mlx-serve" > /dev/null 2>&1; then
        mlx_log "ERROR: MLX Server konnte nicht gestartet werden!"
        echo "MLX-Start fehlgeschlagen! Pruefe $MLX_LOG_FILE"
        return 1
    fi
    touch "$MLX_LOCK_FILE"
    configure_opencode_mlx
    echo ""
    mlx_log "MLX SYSTEM GESTARTET!"
    echo "MLX Server laeuft auf Port $MLX_PORT"
    echo "Modell $(get_mlx_model) geladen"
    echo "OpenCode fuer MLX konfiguriert"
    echo ""
    return 0
}

configure_opencode_mlx() {
    local config_dir="$HOME/Library/Application Support/OpenCode/User"
    local settings_file="$config_dir/settings.json"
    local mlx_port="$(get_mlx_port)"
    mkdir -p "$config_dir"
    if [ -f "$settings_file" ]; then
        cp "$settings_file" "$settings_file.bak"
    fi
    cat > "$settings_file" << EOF
{
  "providers": [
    {
      "name": "MLX Spark",
      "baseUrl": "http://localhost:${mlx_port}/v1",
      "apiKey": "not-needed",
      "enabled": true
    }
  ]
}
EOF
    mlx_log "OpenCode fuer MLX konfiguriert"
}

stop_mlx_spark() {
    if ! pgrep -f "spark-mlx-serve" > /dev/null 2>&1; then
        mlx_log "MLX Server laeuft nicht"
        rm -f "$MLX_LOCK_FILE" "$LOCAL_DEV_DIR/mlx-server.sh"
        return 0
    fi
    mlx_log "Stoppe MLX Server..."
    pkill -f "spark-mlx-serve" 2>/dev/null
    sleep 2
    if pgrep -f "spark-mlx-serve" > /dev/null 2>&1; then
        pkill -9 -f "spark-mlx-serve" 2>/dev/null
        sleep 1
    fi
    rm -f "$MLX_LOCK_FILE" "$LOCAL_DEV_DIR/mlx-server.sh"
    mlx_log "MLX Server gestoppt"
    return 0
}

is_mlx_running() {
    [ -f "$MLX_LOCK_FILE" ] && pgrep -f "spark-mlx-serve" > /dev/null 2>&1
}

# Main Actions
start_ollama_all() {
    check_ollama
    check_opencode
    start_ollama || return 1
    local MODEL="$(get_model)"
    pull_model "$MODEL" || return 1
    configure_opencode_ollama
    start_opencode ollama "$MODEL" 11434 || return 1
    touch "$LOCK_FILE"
    echo ""
    log "OLLAMA SYSTEM GESTARTET!"
    echo "Ollama laeuft auf Port 11434"
    echo "Modell '$MODEL' geladen"
    echo "OpenCode konfiguriert und gestartet"
    echo ""
}

stop_ollama_all() {
    stop_opencode
    stop_ollama
    local MODEL="$(get_model)"
    remove_model "$MODEL"
    rm -f "$LOCK_FILE"
    echo ""
    log "OLLAMA SYSTEM GESTOPPT!"
}

full_reset() {
    echo ""
    echo "WARNUNG: Diese Aktion wird ALLES zuruecksetzen"
    echo "   OpenCode stoppen"
    echo "   Ollama stoppen"
    echo "   ALLE Modelle deinstallieren"
    echo ""
    echo "Diese Aktion kann nicht rueckgaengig gemacht werden!"
    echo ""
    echo -n "Wirlich ALLES deinstallieren\? (ja/nein): "
    read -r
    echo ""
    if [[ ! $REPLY =~ ^[Jj][Aa]?$ ]]; then
        mlx_log "Reset abgebrochen"
        echo "Abgebrochen."
        return
    fi
    stop_ollama_all
    stop_mlx_spark
    local ollama_models_dir="$HOME/.ollama/models"
    if [ -d "$ollama_models_dir" ]; then
        for model_dir in $(ls -1 "$ollama_models_dir" 2>/dev/null | grep -v "^\."); do
            if [ -n "$model_dir" ] && [ -d "$ollama_models_dir/$model_dir" ]; then
                mlx_log "   Deinstalliere: $model_dir"
                rm -rf "$ollama_models_dir/$model_dir"
            fi
        done
    fi
    echo ""
    mlx_log "ALLES ZURUECKGESETZT!"
}

setup_config() {
    echo ""
    echo "Ollama - Modell Setup"
    echo ""
    echo "Waehle ein Modell:"
    echo "  1\) deepseek-coder:6.7b   [BEST fuer Code]"
    echo "  2\) deepseek-coder:1.3b   [Leicht + sehr gut]"
    echo "  3\) codellama:13b         [Meta Code-Llama]"
    echo "  4\) codellama:7b          [Gut fuer Code]"
    echo "  5\) phi3:3.8b             [Schnell]"
    echo "  6\) llama3.2:3b           [Allrounder]"
    echo "  7\) mistral:7b            [Allgemein]"
    echo "  8\) Benutzerdefiniert"
    echo ""
    echo -n "Waehle (1-8) oder Enter fuer deepseek-coder:6.7b: "
    read -r
    echo ""
    local model="deepseek-coder:6.7b"
    case $REPLY in
        2) model="deepseek-coder:1.3b" ;;
        3) model="codellama:13b" ;;
        4) model="codellama:7b" ;;
        5) model="phi3:3.8b" ;;
        6) model="llama3.2:3b" ;;
        7) model="mistral:7b" ;;
        8)
            echo -n "Modellname: "
            read -r
            model="$REPLY"
            ;;
    esac
    if [ -z "$model" ]; then
        model="deepseek-coder:6.7b"
    fi
    cat > "$CONFIG_FILE" << EOF
{
  "model": "$model",
  "ollama": {
    "host": "localhost",
    "port": 11434
  }
}
EOF
    log "Konfiguration gespeichert Modell: $model"
    echo "Gespeichert!"
    echo ""
}

setup_mlx_config() {
    echo ""
    echo "MLX - Spark-X2.5-4B Setup"
    echo ""
    echo "Waehle:"
    echo "  1\) Standard [XHToken/Spark-X2.5-4B, Port 8000]"
    echo "  2\) Benutzerdefiniert"
    echo ""
    echo -n "Waehle (1-2) oder Enter fuer Standard: "
    read -r
    local model="Spark-X2.5-4B"
    local repo="XHToken/Spark-X2.5-4B"
    local port="8000"
    case $REPLY in
        2)
            echo -n "Modellname: "
            read -r
            model="$REPLY"
            echo -n "Repository: "
            read -r
            repo="$REPLY"
            echo -n "Port [Standard 8000]: "
            read -r
            port="${REPLY:-8000}"
            ;;
    esac
    cat > "$MLX_CONFIG_FILE" << EOF
{
  "mlx": {
    "model": "$model",
    "repository": "$repo",
    "device": "gpu",
    "dtype": "bfloat16",
    "port": $port,
    "max_tokens": 4096
  }
}
EOF
    echo "MLX-Konfiguration gespeichert!"
    echo "   Modell: $model, Port: $port"
    echo ""
}

show_menu() {
    while true; do
        echo ""
        echo "Local Dev - Ollama + MLX Manager"
        echo ""
        if is_ollama_running; then
            echo "Ollama: RUNNING [Port 11434, Modell: $(get_model)]"
        else
            echo "Ollama: STOPPED"
        fi
        if is_mlx_running; then
            echo "MLX:    RUNNING [Port $(get_mlx_port), Modell: $(get_mlx_model)]"
        else
            echo "MLX:    STOPPED"
        fi
        if pgrep -if "opencode" > /dev/null 2>&1; then
            echo "OpenCode: RUNNING"
        else
            echo "OpenCode: STOPPED"
        fi
        echo ""
        echo "=== OLLAMA ==="
        echo " 1\) Ollama starten"
        echo " 2\) Ollama stoppen"
        echo ""
        echo "=== MLX Spark ==="
        echo " 3\) MLX starten"
        echo " 4\) MLX stoppen"
        echo ""
        echo "=== ALLES ==="
        echo " 5\) Alles starten"
        echo " 6\) Alles stoppen"
        echo ""
        echo "=== SETUP ==="
        echo " 7\) Ollama Setup"
        echo " 8\) MLX Setup"
        echo ""
        echo "=== SONSTIGES ==="
        echo " 9\) Reset [ALLES deinstallieren]"
        echo " 0\) Beenden"
        echo ""
        echo -n "Wahl (0-9): "
        read -r
        echo ""
        case $REPLY in
            1)
                if ! is_ollama_running; then
                    if [ ! -f "$CONFIG_FILE" ] || [ ! -s "$CONFIG_FILE" ]; then
                        setup_config
                    fi
                    start_ollama_all
                else
                    echo "Ollama laeuft bereits!"
                    echo -n "Enter zum Fortfahren..."
                    read -r
                fi
                ;;
            2)
                if is_ollama_running; then
                    stop_ollama_all
                else
                    echo "Ollama ist bereits gestoppt!"
                    echo -n "Enter zum Fortfahren..."
                    read -r
                fi
                ;;
            3)
                if ! is_mlx_running; then
                    if [ ! -f "$MLX_CONFIG_FILE" ] || [ ! -s "$MLX_CONFIG_FILE" ]; then
                        setup_mlx_config
                    fi
                    if [ ! -d "$HOME/Spark-MLX-LLM" ]; then
                        echo "Spark-MLX-LLM muss installiert werden!"
                        echo -n "Jetzt installieren\? (ja/nein): "
                        read -r
                        if [[ $REPLY =~ ^[Jj][Aa]?$ ]]; then
                            setup_mlx || true
                        fi
                    fi
                    start_mlx_spark
                    if [ $? -eq 0 ] && ! pgrep -if "opencode" > /dev/null 2>&1; then
                        start_opencode mlx "$(get_mlx_model)" "$(get_mlx_port)"
                    fi
                else
                    echo "MLX laeuft bereits!"
                    echo -n "Enter zum Fortfahren..."
                    read -r
                fi
                ;;
            4)
                if is_mlx_running; then
                    stop_mlx_spark
                else
                    echo "MLX ist bereits gestoppt!"
                    echo -n "Enter zum Fortfahren..."
                    read -r
                fi
                ;;
            5)
                if ! is_ollama_running; then
                    if [ ! -f "$CONFIG_FILE" ] || [ ! -s "$CONFIG_FILE" ]; then
                        setup_config
                    fi
                    start_ollama_all
                fi
                if ! is_mlx_running; then
                    if [ ! -f "$MLX_CONFIG_FILE" ] || [ ! -s "$MLX_CONFIG_FILE" ]; then
                        setup_mlx_config
                    fi
                    if [ ! -d "$HOME/Spark-MLX-LLM" ]; then
                        echo "Installiere Spark-MLX-LLM..."
                        setup_mlx || true
                    fi
                    start_mlx_spark
                fi
                if ! pgrep -if "opencode" > /dev/null 2>&1; then
                    start_opencode mlx "$(get_mlx_model)" "$(get_mlx_port)"
                fi
                echo ""
                echo "ALLE SYSTEME GESTARTET!"
                echo "Ollama: Port 11434, Modell: $(get_model)"
                echo "MLX:    Port $(get_mlx_port), Modell: $(get_mlx_model)"
                ;;
            6)
                stop_opencode
                stop_ollama_all
                stop_mlx_spark
                echo ""
                echo "ALLE SYSTEME GESTOPPT!"
                ;;
            7) setup_config ;;
            8) setup_mlx_config ;;
            9) full_reset ;;
            0) log "Skript beendet"; exit 0 ;;
            *) echo "Ungueltige Auswahl!" ;;
        esac
    done
}

main() {
    check_local_dev
    check_ollama
    check_python
    check_opencode
    touch "$LOG_FILE"
    touch "$MLX_LOG_FILE"
    if [ ! -f "$CONFIG_FILE" ] || [ ! -s "$CONFIG_FILE" ]; then
        setup_config
    fi
    if [ ! -f "$MLX_CONFIG_FILE" ] || [ ! -s "$MLX_CONFIG_FILE" ]; then
        setup_mlx_config
    fi
    show_menu
}

main
exit 0
