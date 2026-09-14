#!/bin/zsh

# =============================================
# Reset Ollama + OpenCode Script
# Doppelklick: Stoppt ALLES und deinstalliert alle Modelle
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/ollama-config.json"
LOG_FILE="${SCRIPT_DIR}/reset-ollama.log"

# Logging
log() {
    echo "[$(date +'%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Confirmation dialog
confirm_reset() {
    echo ""
    echo "⚠️  WARNUNG: Dieses Skript wird FOLGENDES durchführen:"
    echo "   1. OpenCode stoppen"
    echo "   2. Ollama stoppen"
    echo "   3. ALLE geladenen Modelle aus dem RAM entfernen"
    echo "   4. ALLE Modelle von der Festplatte DEINSTALLIEREN"
    echo ""
    echo "💥 Diese Aktion kann nicht rückgängig gemacht werden!"
    echo ""
    read -p "Möchtest du wirklich ALLE Ollama-Modelle deinstallieren? (ja/nein): " -r
    echo ""
    if [[ ! $REPLY =~ ^[Jj][Aa]?$ ]]; then
        log "❌ Reset abgebrochen durch Benutzer"
        echo "❌ Abgebrochen. Keine Änderungen vorgenommen."
        exit 0
    fi
}

# Stop OpenCode
stop_opencode() {
    if pgrep -f "OpenCode" > /dev/null 2>&1; then
        log "🛑 Stoppe OpenCode..."
        pkill -f "OpenCode" 2>/dev/null
        sleep 2
        if pgrep -f "OpenCode" > /dev/null 2>&1; then
            killall "OpenCode" 2>/dev/null
            sleep 1
        fi
        if ! pgrep -f "OpenCode" > /dev/null 2>&1; then
            log "✅ OpenCode gestoppt"
        else
            log "⚠️  OpenCode konnte nicht vollständig gestoppt werden"
        fi
    else
        log "✅ OpenCode läuft nicht"
    fi
}

# Stop Ollama
stop_ollama() {
    if pgrep -x "ollama" > /dev/null 2>&1; then
        log "🛑 Stoppe Ollama..."
        pkill -x "ollama" 2>/dev/null
        sleep 2
        if pgrep -x "ollama" > /dev/null 2>&1; then
            log "⚠️  Ollama konnte nicht vollständig gestoppt werden"
            return 1
        fi
        log "✅ Ollama gestoppt"
        return 0
    else
        log "✅ Ollama läuft nicht"
        return 0
    fi
}

# Remove all models from RAM
remove_all_models_from_ram() {
    log "🧹 Entferne alle Modelle aus dem RAM..."
    local models_in_ram
    models_in_ram=$(ollama list 2>/dev/null | grep -v "^NAME" | awk '{print $1}')
    
    if [ -z "$models_in_ram" ]; then
        log "✅ Keine Modelle im RAM geladen"
        return 0
    fi
    
    for model in $models_in_ram; do
        if [ -n "$model" ]; then
            log "   Entferne '$model' aus RAM..."
            ollama rm "$model" >> "$LOG_FILE" 2>&1
        fi
    done
    log "✅ Alle Modelle aus RAM entfernt"
}

# Uninstall all models from disk
uninstall_all_models() {
    log "🗑️  Deinstalliere ALLE Ollama-Modelle von der Festplatte..."
    local ollama_models_dir="$HOME/.ollama/models"
    
    if [ ! -d "$ollama_models_dir" ]; then
        log "✅ Kein Ollama-Modellverzeichnis gefunden"
        return 0
    fi
    
    # Get all model directories
    local model_dirs
    model_dirs=$(ls -1 "$ollama_models_dir" 2>/dev/null | grep -v "^\." | head -n -1)
    
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

# Clean up manifest and other files
cleanup_ollama_files() {
    log "🧹 Bereinige Ollama-Cache und Manifest-Dateien..."
    
    # Remove manifest files
    if [ -d "$HOME/.ollama/manifests" ]; then
        rm -f "$HOME/.ollama/manifests"/*.json 2>/dev/null
        log "   Manifest-Dateien bereinigt"
    fi
    
    # Remove blob cache
    if [ -d "$HOME/.ollama/blobs" ]; then
        rm -rf "$HOME/.ollama/blobs"/* 2>/dev/null
        log "   Blob-Cache bereinigt"
    fi
}

# Main function
main() {
    confirm_reset
    
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║   Reset Ollama + OpenCode (ALLE MODELLE)       ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    
    stop_opencode
    stop_ollama
    remove_all_models_from_ram
    uninstall_all_models
    cleanup_ollama_files
    
    echo ""
    log "✅ ALLES zurückgesetzt!"
    echo "✅ OpenCode gestoppt"
    echo "✅ Ollama gestoppt"
    echo "✅ Alle Modelle aus RAM entfernt"
    echo "✅ Alle Modelle deinstalliert"
    echo ""
    echo "💡 Ollama und OpenCode können jetzt neu gestartet werden"
    echo "   (Doppelklick auf ollama-opencode.command)"
    echo ""
    echo "⏳ Log-Datei: $LOG_FILE"
    echo ""
}

main

exit 0
