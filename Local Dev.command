#!/bin/zsh

# =============================================
# Local Dev - MLX Spark + OpenCode Manager
# Einfaches Skript: Starten, Stoppen, Config
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
LOCAL_DEV_DIR="${SCRIPT_DIR}/local-dev"
CONFIG_FILE="${LOCAL_DEV_DIR}/mlx-config.json"
LOCK_FILE="${LOCAL_DEV_DIR}/.mlx-spark.lock"
LOG_FILE="${LOCAL_DEV_DIR}/mlx-spark.log"

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

check_opencode() {
    if ! command -v open &> /dev/null; then
        echo "open Befehl nicht gefunden!"
        exit 1
    fi
    if [ ! -d "/Applications/OpenCode.app" ] && [ ! -d "~/Applications/OpenCode.app" ]; then
        echo "OpenCode.app nicht gefunden!"
        echo "Installiere OpenCode in /Applications/ oder ~/Applications/"
        echo -n "Druecke Enter zum Beenden..."
        read -r
        exit 1
    fi
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

# Start MLX Server
start_mlx() {
    check_python
    check_opencode
    
    if [ -f "$LOCK_FILE" ]; then
        if pgrep -f "mlx_lm.server" > /dev/null 2>&1; then
            log "MLX Server laeuft bereits"
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
    
    log "Starte MLX Server mit $(get_model) auf Port $PORT..."
    
    cd ~/Spark-MLX-LLM
    source .venv/bin/activate
    nohup mlx_lm.server --model "$REPO" --port $PORT >> "$LOG_FILE" 2>&1 &
    sleep 5
    
    if ! pgrep -f "mlx_lm.server" > /dev/null 2>&1; then
        log "ERROR: MLX Server konnte nicht gestartet werden!"
        echo "Pruefe: $LOG_FILE"
        return 1
    fi
    
    touch "$LOCK_FILE"
    configure_opencode
    
    echo ""
    log "MLX Server gestartet!"
    echo "Server: http://localhost:$PORT"
    echo "Modell: $(get_model)"
    echo ""
    return 0
}

# Stop MLX Server
stop_mlx() {
    if ! pgrep -f "mlx_lm.server" > /dev/null 2>&1; then
        log "MLX Server laeuft nicht"
        rm -f "$LOCK_FILE"
        return 0
    fi
    
    log "Stoppe MLX Server..."
    pkill -f "mlx_lm.server" 2>/dev/null
    sleep 2
    if pgrep -f "mlx_lm.server" > /dev/null 2>&1; then
        pkill -9 -f "mlx_lm.server" 2>/dev/null
        sleep 1
    fi
    rm -f "$LOCK_FILE"
    log "MLX Server gestoppt"
    return 0
}

# Configure OpenCode
configure_opencode() {
    local config_dir="$HOME/Library/Application Support/OpenCode/User"
    local settings_file="$config_dir/settings.json"
    local port="$(get_port)"
    local model="$(get_model)"
    
    mkdir -p "$config_dir"
    
    cat > "$settings_file" << EOF
{
  "providers": [
    {
      "name": "MLX Spark",
      "baseUrl": "http://localhost:$port",
      "apiKey": "not-needed",
      "enabled": true,
      "models": ["$model"]
    }
  ],
  "defaultProvider": "MLX Spark"
}
EOF
    
    log "OpenCode konfiguriert"
}

# Check if running
is_running() {
    [ -f "$LOCK_FILE" ] && pgrep -f "mlx_lm.server" > /dev/null 2>&1
}

# Setup config
setup_config() {
    echo ""
    echo "MLX Spark - Konfiguration anpassen"
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
        echo "Lass leer für Standardwert"
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
    
    cat > "$CONFIG_FILE" << EOF
{
  "mlx": {
    "model": "$model",
    "repository": "$repo",
    "device": "$device",
    "dtype": "$dtype",
    "port": $port
  }
}
EOF
    
    echo ""
    log "Konfiguration gespeichert"
    echo "Neue Einstellungen:"
    echo "  Modell: $model"
    echo "  Repository: $repo"
    echo "  Port: $port"
    echo "  Device: $device"
    echo "  Dtype: $dtype"
    echo ""
}

# Main menu
show_menu() {
    while true; do
        echo ""
        echo "Local Dev - MLX Spark + OpenCode"
        echo ""
        
        if is_running; then
            echo "Status: LAEUFT [Port $(get_port), Modell: $(get_model)]"
        else
            echo "Status: GESTOPPT"
        fi
        
        echo ""
        echo "1) Config starten     - MLX Server + OpenCode starten"
        echo "2) Config stoppen     - MLX Server beenden"
        echo "3) Config anpassen    - Einstellungen aendern"
        echo "4) Beenden           - Skript schliessen"
        echo ""
        
        echo -n "Wahl (1-4): "
        read -r
        echo ""
        
        case $REPLY in
            1)
                if ! is_running; then
                    start_mlx
                else
                    echo "MLX Server laeuft bereits!"
                fi
                ;;
            2)
                if is_running; then
                    stop_mlx
                else
                    echo "MLX Server ist bereits gestoppt!"
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
  }
}
EOF
        log "Standardkonfiguration erstellt"
    fi
    
    # Show menu
    show_menu
}

main
exit 0
