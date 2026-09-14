# Local Dev - OpenCode + Ollama + MLX

**Ein All-in-One Skript** für macOS, das Setup, Start/Stop und Reset für Ollama, MLX und OpenCode in einem Menü vereint.

---

## 🚀 Schnellstart

**Einfach auf den Desktop legen:**
1. Erstelle einen **Alias** des Skripts:
   - Rechtsklick auf `Local Dev.command` → **Alias erzeugen** → Auf Desktop ziehen
   
   **Vorteile:** Updates werden automatisch übernommen!

**Oder kopieren:**
   ```bash
   cp "/Users/tobiaspitschi/Documents/GitHub/vibecode-workspace/Local Dev.command" ~/Desktop/
   ```

2. **Per Doppelklick auf `Local Dev.command` starten**
   - Beim ersten Start wird automatisch ein Setup-Dialog angezeigt

3. **Option 5 wählen** → Installiert automatisch:
   - Spark-MLX-LLM für Spark-X2.5-4B
   - Ollama mit deepseek-coder:6.7b (oder dein gewähltes Modell)
   - OpenCode mit beiden Providern konfiguriert

---

## 🔄 Funktionsweise

### Architektur
```
OpenCode
   │
   ├─► Ollama (Port 11434) → deepseek-coder:6.7b u.a.
   │
   └─► MLX Server (Port 8000) → Spark-X2.5-4B
          │
          └─► Spark-MLX-LLM (Apple Silicon optimiert)
```

### Menü-Optionen (nach Doppelklick):

| Option | Aktion | Beschreibung |
|--------|--------|-------------|
| **1) Ollama starten** | 🚀 | Startet Ollama + lädt Modell + konfiguriert OpenCode |
| **2) Ollama stoppen** | 🛑 | Stoppt Ollama + entfernt Modell aus RAM |
| **3) MLX starten** | ⚡ | Startet MLX-Server mit Spark-X2.5-4B + konfiguriert OpenCode |
| **4) MLX stoppen** | ⏹️ | Stoppt MLX-Server |
| **5) Alles starten** | 🚀🚀 | Startet Ollama + MLX + OpenCode gleichzeitig |
| **6) Alles stoppen** | 🛑🛑 | Stoppt alle Systeme |
| **7) Ollama Setup** | ⚙️ | Ollama-Modell auswählen (deepseek, codellama, etc.) |
| **8) MLX Setup** | ⚡⚙️ | Spark-X2.5-4B konfigurieren (Port, Repository) |
| **9) Reset** | 💥 | **ALLES zurücksetzen** – Deinstalliert ALLE Ollama-Modelle |
| **0) Beenden** | 🚪 | Skript schließen |

### Automatisches Setup:
- Beim ersten Start (keine Config) → **Setup-Dialog** wird automatisch angezeigt
- Beim nächsten Start → **Menü** mit allen Optionen
- MLX (Spark-MLX-LLM) wird automatisch bei erster Nutzung installiert

**💡 Tipp:** Nutze das **`Local Dev.command`** im Root-Verzeichnis für beste Desktop-Integration!

---

## 📝 Konfiguration

### `ollama-config.json` (für Ollama)

```json
{
  "model": "deepseek-coder:6.7b",  // Standardmodell für Code
  "ollama": {
    "host": "localhost",
    "port": 11434
  }
}
```

### `mlx-config.json` (für Spark-X2.5-4B)

```json
{
  "mlx": {
    "model": "Spark-X2.5-4B",
    "repository": "XHToken/Spark-X2.5-4B",
    "device": "gpu",
    "dtype": "bfloat16",
    "port": 8000,
    "max_tokens": 4096
  }
}
```

---

## 📁 Dateistruktur

```
.
├── Local Dev.command           # Hauptskript (All-in-One)
└── local-dev/
    ├── Local Dev.command       # Kopie des Hauptskripts
    ├── ollama-config.json     # Ollama Modell-Konfiguration
    ├── mlx-config.json        # MLX/Spark Konfiguration
    ├── local-dev.log          # Log für Ollama-Aktionen
    └── mlx-spark.log          # Log für MLX-Aktionen
```

**Hinweis:** Die alten Skripte `ollama-opencode.command` und `reset-ollama.command` sind noch vorhanden für Kompatibilität, werden aber nicht mehr benötigt.

---

## ⚙️ Anforderungen

### Für Ollama:
- **Ollama** muss installiert sein (`which ollama` im Terminal testen)
  → [Installationsanleitung](https://ollama.com)

### Für MLX (Spark-X2.5-4B):
- **Python 3.9+** muss installiert sein
  → `brew install python`
- **Git** muss installiert sein
  → `xcode-select --install`
- **MLX** wird automatisch installiert (verwendet Apple Metal GPU)

### Für OpenCode:
- **OpenCode** muss in `/Applications/` oder `~/Applications/` installiert sein

---

## 📊 Logging

Alle Aktionen werden protokolliert:
- **`local-dev/local-dev.log`** – Ollama-Aktionen
- **`local-dev/mlx-spark.log`** – MLX/Spark-Aktionen

---

## 🔧 Problembehebung

### Ollama startet nicht
- Prüfe, ob Ollama installiert ist: `ollama --version`
- Starte Ollama manuell: `ollama serve`
- Prüfe Port-Konflikte: `lsof -i :11434`

### Modell kann nicht geladen werden
- Prüfe, ob das Modell existiert: `ollama list`
- Lade das Modell manuell: `ollama pull deepseek-coder:6.7b`
- Prüfe Speicherplatz: Spark-X2.5-4B benötigt ~8GB RAM

### MLX startet nicht
- Prüfe, ob Python installiert ist: `python3 --version`
- Prüfe Spark-MLX-LLM Installation: `ls ~/Spark-MLX-LLM`
- Prüfe MLX-Log: `cat local-dev/mlx-spark.log`
- Für M1/M2 Macs: Stelle sicher, dass Metal GPU verfügbar ist

### OpenCode startet nicht
- Prüfe, ob die App in `/Applications/OpenCode.app` existiert
- Starte OpenCode manuell und prüfe die Konfiguration
- Prüfe die OpenCode Settings: `cat ~/Library/Application\ Support/OpenCode/User/settings.json`

### Port-Konflikte
- Ollama: Port 11434
- MLX: Port 8000 (standardmäßig, anpassbar in mlx-config.json)
- Prüfe mit: `lsof -i :PORTNR`

---

## 💡 Warum MLX für Spark auf Apple Silicon?

Dein M2 Max hat **32GB Unified Memory** (geteilter Speicher für CPU + GPU). 
MLX ist Apples Framework, das speziell für diese Architektur optimiert ist:

- **Kein Kopieren** von Tensoren zwischen RAM und GPU
- **Direkter Zugriff** auf die Metal-GPU
- **Bessere Performance** für Spark-Modelle
- **Unterstützung** für spark2_5-Architektur (die Standard-Ollama noch nicht kann)

**Vergleich:**
| Kriterium | Ollama | MLX |
|----------|--------|-----|
| Einfachheit | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Apple Silicon Optimierung | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Spark-X2.5-4B Unterstützung | ❌ | ✅ |
| Speichereffizienz | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

**Empfehlung:** Nutze **beides** parallel!
- **Ollama** für unterstützte Modelle (llama3, mistral, codellama, etc.)
- **MLX** für Spark-X2.5-4B und spezielle Apple-Silicon-Modelle
