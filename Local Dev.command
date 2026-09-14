#!/bin/zsh

# =============================================
# Local Dev - Ollama + OpenCode Manager
# Ein Skript für ALLES: Setup, Start/Stop, Reset
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
LOCAL_DEV_DIR="${SCRIPT_DIR}/local-dev"
CONFIG_FILE="${LOCAL_DEV_DIR}/ollama-config.json"
LOCK_FILE="${LOCAL_DEV_DIR}/.ollama-opencode.lock"
LOG_FILE="${LOCAL_DEV_DIR}/local-dev.log"

# Logging
log() {
    echo "[$(date +'%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if local-dev directory exists
check_local_dev() {
    if [ ! -d "$LOCAL_DEV_DIR" ]; then
        echo "❌ ERROR: local-dev Verzeichnis nicht gefunden!"
        echo "   Erwartet: ${LOCAL_DEV_DIR}"
        exit 1
    fi
}

# Check dependencies
check_ollama() {
    if ! command -v ollama &> /dev/null; then
        echo "❌ Ollama ist nicht installiert!"
        echo "   Installiere Ollama: curl -fsSL https://ollama.com/install.sh | sh"
        read -p "Drücke Enter zum Beenden..." -r
        exit 1
    fi
}

check_opencode() {
    if [ ! -d "/Applications/OpenCode.app" ] && [ ! -d "~/Applications/OpenCode.app" ]; then
        echo "❌ OpenCode.app nicht gefunden!"
        echo "   Installiere OpenCode in /Applications/ oder ~/Applications/"
        read -p "Drücke Enter zum Beenden..." -r
        exit 1
    fi
}

# Setup function
setup_config() {
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║      Local Dev - Erstes Setup                   ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    
    echo "📝 Standardmodell auswählen:"
    echo "   1) llama3       (empfohlen)"
    echo "   2) mistral:7b   (schnell, gut für Code)"
    echo "   3) phi3         (leicht)"
    echo "   4) Benutzerdefiniert"
    echo ""
    read -p "Wähle eine Option (1-4) oder Enter für llama3: " -r
    echo ""
    
    local model="llama3"
    case $REPLY in
        2|mistral)
            model="mistral:7b"
            ;;
        3|phi3)
            model="phi3"
            ;;
        4)
            read -p "Gib den Modellnamen ein: " -r
            model="$REPLY"
            ;;
    esac
    
    if [ -z "$model" ]; then
        model="llama3"
    fi
    
    echo "✅ Gewähltes Modell: $model"
    echo ""
    
    cat > "$CONFIG_FILE" << EOF
{
  "model": "$model",
  "ollama": {
    "host": "localhost",
    "port": 11434
  }
}
EOF
    
    log "✅ Konfiguration erstellt: $CONFIG_FILE (Modell: $model)"
    echo "✅ Konfiguration gespeichert!"
    echo ""
}

# Get model from config
get_model() {
    if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
        grep -A1 '"model"' "$CONFIG_FILE" | tail -n1 | tr -d ' "{},' | head -n1
    else
        echo "llama3"
    fi
}

# Get OpenCode app path
get_opencode_path() {
    if [ -d "/Applications/OpenCode.app" ]; then
        echo "/Applications/OpenCode.app"
    elif [ -d "~/Applications/OpenCode.app" ]; then
        echo "~/Applications/OpenCode.app"
    else
        echo ""
    fi
}

# Start Ollama
start_ollama() {
    if pgrep -x "ollama" > /dev/null 2>&1; then
        log "✅ Ollama läuft bereits"
        return 0
    fi
    
    log "🚀 Starte Ollama..."
    ollama serve > /dev/null 2>&1 &
    sleep 3
    
    if ! pgrep -x "ollama" > /dev/null 2>&1; then
        log "❌ ERROR: Ollama konnte nicht gestartet werden!"
        echo "❌ Ollama-Start fehlgeschlagen!"
        return 1
    fi
    
    log "✅ Ollama gestartet (Port 11434)"
    return 0
}

# Stop Ollama
stop_ollama() {
    if ! pgrep -x "ollama" > /dev/null 2>&1; then
        log "✅ Ollama läuft nicht"
        return 0
    fi
    
    log "🛑 Stoppe Ollama..."
    pkill -x "ollama" 2>/dev/null
    sleep 2
    
    if pgrep -x "ollama" > /dev/null 2>&1; then
        log "❌ ERROR: Ollama konnte nicht gestoppt werden!"
        return 1
    fi
    
    log "✅ Ollama gestoppt"
    return 0
}

# Pull model
pull_model() {
    local model="$1"
    
    if ollama list | grep -q "$model"; then
        log "✅ Modell '$model' ist bereits geladen"
        return 0
    fi
    
    log "📥 Lade Modell '$model'..."
    if ollama pull "$model" >> "$LOG_FILE" 2>&1; then
        log "✅ Modell '$model' geladen"
        return 0
    else
        log "❌ ERROR: Modell '$model' konnte nicht geladen werden!"
        return 1
    fi
}

# Remove model from RAM
remove_model() {
    local model="$1"
    
    if ! ollama list | grep -q "$model"; then
        log "✅ Modell '$model' ist nicht im RAM"
        return 0
    fi
    
    log "🗑️  Entferne Modell '$model' aus RAM..."
    if ollama rm "$model" >> "$LOG_FILE" 2>&1; then
        log "✅ Modell '$model' aus RAM entfernt"
        return 0
    else
        log "❌ ERROR: Modell '$model' konnte nicht entfernt werden!"
        return 1
    fi
}

# Configure OpenCode
configure_opencode() {
    local opencode_path="$(get_opencode_path)"
    local config_dir="$HOME/Library/Application Support/OpenCode/User"
    local settings_file="$config_dir/settings.json"
    
    mkdir -p "$config_dir"
    
    if [ -f "$settings_file" ]; then
        cp "$settings_file" "$settings_file.bak"
    fi
    
    cat > "$settings_file" << EOF
{
  "ollama.baseUrl": "http://localhost:11434",
  "ollama.enabled": true,
  "ollama.defaultModel": "$(get_model)"
}
EOF
    
    log "✅ OpenCode für Ollama konfiguriert"
}

# Start OpenCode
start_opencode() {
    if pgrep -f "OpenCode" > /dev/null 2>&1; then
        log "✅ OpenCode läuft bereits"
        return 0
    fi
    
    log "🚀 Starte OpenCode..."
    open -a "OpenCode" --args --user-data-dir="$HOME/Library/Application Support/OpenCode" > /dev/null 2>&1 &
    sleep 2
    
    if ! pgrep -f "OpenCode" > /dev/null 2>&1; then
        log "❌ ERROR: OpenCode konnte nicht gestartet werden!"
        return 1
    fi
    
    log "✅ OpenCode gestartet"
    return 0
}

# Stop OpenCode
stop_opencode() {
    if ! pgrep -f "OpenCode" > /dev/null 2>&1; then
        log "✅ OpenCode läuft nicht"
        return 0
    fi
    
    log "🛑 Stoppe OpenCode..."
    pkill -f "OpenCode" 2>/dev/null
    sleep 2
    
    if pgrep -f "OpenCode" > /dev/null 2>&1; then
        killall "OpenCode" 2>/dev/null
        sleep 1
    fi
    
    if pgrep -f "OpenCode" > /dev/null 2>&1; then
        log "⚠️  OpenCode konnte nicht vollständig gestoppt werden"
        return 1
    fi
    
    log "✅ OpenCode gestoppt"
    return 0
}

# Reset ALL models from disk
reset_all_models() {
    log "🗑️  Deinstalliere ALLE Ollama-Modelle von der Festplatte..."
    local ollama_models_dir="$HOME/.ollama/models"
    
    if [ ! -d "$ollama_models_dir" ]; then
        log "✅ Kein Ollama-Modellverzeichnis gefunden"
        return 0
    fi
    
    local model_dirs
    model_dirs=$(ls -1 "$ollama_models_dir" 2>/dev/null | grep -v "^\.")
    
    if [ -z "$model_dirs" ]; then
        log "✅ Keine Modelle zum Deinstallieren gefunden"
        return 0
    fi
    
    local count=0
    for model_dir in $model_dirs; do
        if [ -n "$model_dir" ]; then
            local model_path="$ollama_models_dir/$model_dir"
            if [ -d "$model_path" ]; then
                log "   Deinstalliere Modell: $model_dir"
                rm -rf "$model_path"
                ((count++))
            fi
        fi
    done
    log "✅ $count Modell(e) deinstalliert"
}

# Clean up Ollama files
cleanup_ollama_files() {
    log "🧹 Bereinige Ollama-Cache..."
    
    if [ -d "$HOME/.ollama/manifests" ]; then
        rm -f "$HOME/.ollama/manifests"/*.json 2>/dev/null
        log "   Manifest-Dateien bereinigt"
    fi
    
    if [ -d "$HOME/.ollama/blobs" ]; then
        rm -rf "$HOME/.ollama/blobs"/* 2>/dev/null
        log "   Blob-Cache bereinigt"
    fi
}

# Check if system is running
is_running() {
    [ -f "$LOCK_FILE" ] && pgrep -x "ollama" > /dev/null 2>&1
}

# Start everything
start_all() {
    check_ollama
    check_opencode
    
    start_ollama || exit 1
    
    local MODEL="$(get_model)"
    pull_model "$MODEL" || exit 1
    
    configure_opencode
    start_opencode || exit 1
    
    touch "$LOCK_FILE"
    
    echo ""
    log "✅ ALLES GESTARTET!"
    echo "✅ Ollama läuft auf Port 11434"
    echo "✅ Modell '$MODEL' geladen"
    echo "✅ OpenCode konfiguriert und gestartet"
    echo ""
    echo "💡 Doppelklick auf das Skript zum STOPPEN"
}

# Stop everything
stop_all() {
    stop_opencode
    stop_ollama
    
    local MODEL="$(get_model)"
    remove_model "$MODEL"
    
    rm -f "$LOCK_FILE"
    
    echo ""
    log "✅ ALLES GESTOPPT!"
    echo "✅ OpenCode geschlossen"
    echo "✅ Modell aus RAM entfernt"
    echo "✅ Ollama gestoppt"
}

# Full reset
full_reset() {
    echo ""
    echo "⚠️  WARNUNG: Diese Aktion wird ALLES zurücksetzen:"
    echo "   - OpenCode stoppen"
    echo "   - Ollama stoppen"
    echo "   - ALLE Modelle aus RAM entfernen"
    echo "   - ALLE Modelle von der Festplatte DEINSTALLIEREN"
    echo ""
    echo "💥 Diese Aktion kann nicht rückgängig gemacht werden!"
    echo ""
    read -p "Möchtest du wirklich ALLE Ollama-Modelle deinstallieren? (ja/nein): " -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Jj][Aa]?$ ]]; then
        log "❌ Reset abgebrochen durch Benutzer"
        echo "❌ Abgebrochen. Keine Änderungen vorgenommen."
        return
    fi
    
    stop_all
    reset_all_models
    cleanup_ollama_files
    
    echo ""
    log "✅ ALLES ZURÜCKGESETZT!"
    echo "✅ Alle Modelle deinstalliert"
    echo "✅ Cache bereinigt"
}

# Show main menu
show_menu() {
    while true; do
        echo ""
        echo "╔════════════════════════════════════════╗"
        echo "║          Local Dev - Ollama Manager            ║"
        echo "╚════════════════════════════════════════╝"
        echo ""
        
        # Check status
        if is_running; then
            echo "🟢 Status: LÄUFT (Ollama + OpenCode aktiv)"
        else
            echo "🔴 Status: GESTOPPT"
        fi
        
        if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
            echo "✅ Konfiguration: Vorhanden (Modell: $(get_model))"
        else
            echo "⚠️  Konfiguration: FEHLEND (Setup erforderlich)"
        fi
        
        echo ""
        echo "Wähle eine Aktion:"
        echo "  1) Starten          - Ollama + OpenCode starten"
        echo "  2) Stoppen          - Alles beenden"
        echo "  3) Reset            - ALLES zurücksetzen + Modelle deinstallieren"
        echo "  4) Setup            - Konfiguration anpassen"
        echo "  5) Beenden          - Skript schließen"
        echo ""
        
        read -p "Deine Wahl (1-5): " -r
        echo ""
        
        case $REPLY in
            1)
                if ! is_running; then
                    # Check config
                    if [ ! -f "$CONFIG_FILE" ] || [ ! -s "$CONFIG_FILE" ]; then
                        setup_config
                    fi
                    start_all
                else
                    echo "⚠️  System läuft bereits!"
                    read -p "Drücke Enter zum Fortfahren..." -r
                fi
                ;;
            2)
                if is_running; then
                    stop_all
                else
                    echo "⚠️  System ist bereits gestoppt!"
                    read -p "Drücke Enter zum Fortfahren..." -r
                fi
                ;;
            3)
                full_reset
                ;;
            4)
                setup_config
                ;;
            5)
                log "✅ Skript beendet"
                exit 0
                ;;
            *)
                echo "⚠️  Ungültige Auswahl!"
                ;;
        esac
    done
}

# Main
main() {
    check_local_dev
    
    # Create log file if it doesn't exist
    touch "$LOG_FILE"
    
    # Check if config exists
    if [ ! -f "$CONFIG_FILE" ] || [ ! -s "$CONFIG_FILE" ]; then
        setup_config
    fi
    
    # Show menu
    show_menu
}

main

exit 0
