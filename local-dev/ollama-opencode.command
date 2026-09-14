#!/bin/zsh

# =============================================
# OpenCode + Ollama Toggle Script
# Doppelklick: Startet/Stoppt Ollama + OpenCode
# mit automatischer Modell-Konfiguration
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/ollama-config.json"
LOCK_FILE="${SCRIPT_DIR}/.ollama-opencode.lock"
LOG_FILE="${SCRIPT_DIR}/ollama-opencode.log"

# Logging
log() {
    echo "[$(date +'%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if Ollama is installed
check_ollama() {
    if ! command -v ollama &> /dev/null; then
        log "❌ ERROR: Ollama ist nicht installiert!"
        echo "💡 Installiere Ollama erst: curl -fsSL https://ollama.com/install.sh | sh"
        exit 1
    fi
}

# Check if OpenCode is installed
check_opencode() {
    if ! command -v open &> /dev/null; then
        log "❌ ERROR: OpenCode App nicht gefunden!"
        exit 1
    fi
    
    # Check if OpenCode app exists
    if [ ! -d "/Applications/OpenCode.app" ] && [ ! -d "~/Applications/OpenCode.app" ]; then
        log "❌ ERROR: OpenCode.app nicht in /Applications/ oder ~/Applications/ gefunden!"
        exit 1
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

# Get model from config
get_model() {
    if [ -f "$CONFIG_FILE" ]; then
        grep -A1 '"model"' "$CONFIG_FILE" | tail -n1 | tr -d ' "{},' | head -n1
    else
        echo "llama3"
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
        log "✅ Modell '$model' ist bereits vorhanden"
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

# Remove model
remove_model() {
    local model="$1"
    
    if ! ollama list | grep -q "$model"; then
        log "✅ Modell '$model' ist nicht geladen"
        return 0
    fi
    
    log "🗑️  Entferne Modell '$model' aus dem Arbeitsspeicher..."
    if ollama rm "$model" >> "$LOG_FILE" 2>&1; then
        log "✅ Modell '$model' entfernt"
        return 0
    else
        log "❌ ERROR: Modell '$model' konnte nicht entfernt werden!"
        return 1
    fi
}

# Configure OpenCode for Ollama
configure_opencode() {
    local opencode_path="$(get_opencode_path)"
    local config_dir="$HOME/Library/Application Support/OpenCode/User"
    local settings_file="$config_dir/settings.json"
    
    # Create config directory if it doesn't exist
    mkdir -p "$config_dir"
    
    # Backup existing settings if they exist
    if [ -f "$settings_file" ]; then
        cp "$settings_file" "$settings_file.bak"
    fi
    
    # Create or update settings.json with Ollama config
    cat > "$settings_file" << EOF
{
  "ollama.baseUrl": "http://localhost:11434",
  "ollama.enabled": true,
  "ollama.defaultModel": "$(get_model)"
}
EOF
    
    log "✅ OpenCode für Ollama konfiguriert (Port 11434)"
}

# Start OpenCode
start_opencode() {
    local opencode_path="$(get_opencode_path)"
    
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
        log "❌ ERROR: OpenCode konnte nicht gestoppt werden!"
        return 1
    fi
    
    log "✅ OpenCode gestoppt"
    return 0
}

# Check if already running
is_running() {
    [ -f "$LOCK_FILE" ] && [ -f "$CONFIG_FILE" ]
}

# Main function
main() {
    check_ollama
    check_opencode
    
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║   OpenCode + Ollama Toggle Script           ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    
    if is_running; then
        # STOP MODE
        log "🔴 STOPPING alles..."
        echo "🛑 Stoppe OpenCode + Ollama..."
        
        stop_opencode
        stop_ollama
        
        MODEL="$(get_model)"
        remove_model "$MODEL"
        
        rm -f "$LOCK_FILE"
        
        echo ""
        log "✅ Alles gestoppt und bereinigt!"
        echo "✅ OpenCode geschlossen, Modell entfernt, Ollama gestoppt"
        
    else
        # START MODE
        log "🟢 STARTING alles..."
        echo "🚀 Starte OpenCode + Ollama..."
        
        start_ollama || exit 1
        
        MODEL="$(get_model)"
        pull_model "$MODEL" || exit 1
        
        configure_opencode
        start_opencode || exit 1
        
        # Create lock file
        touch "$LOCK_FILE"
        
        echo ""
        log "✅ Alles gestartet!"
        echo "✅ Ollama läuft auf Port 11434"
        echo "✅ Modell '$MODEL' geladen"
        echo "✅ OpenCode konfiguriert und gestartet"
        echo ""
        echo "💡 Doppelklick auf das Skript zum BEENDEN"
    fi
    
    echo ""
    echo "⏳ Log-Datei: $LOG_FILE"
    echo ""
}

main

exit 0
