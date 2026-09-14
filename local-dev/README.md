# Local Dev - OpenCode + Ollama

**Ein All-in-One Skript** für macOS, das Setup, Start/Stop und Reset für Ollama + OpenCode in einem Menü vereint.

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

2. **Modell in der Konfiguration anpassen (optional)**
   - Öffne `ollama-config.json` (wird beim ersten Start automatisch erstellt!)
   - Ändere das Feld `"model"` zu deinem Wunschmodell (z. B. `"mistral:7b"`, `"phi3"`, `"llama3"`)

3. **Per Doppelklick auf `Local Dev.command` starten**

---

## 🔄 Funktionsweise

### Menü-Optionen (nach Doppelklick):

| Option | Aktion | Beschreibung |
|--------|--------|-------------|
| **1) Starten** | 🚀 | Startet Ollama + lädt Modell + konfiguriert OpenCode + startet OpenCode |
| **2) Stoppen** | 🛑 | Stoppt OpenCode + entfernt Modell aus RAM + stoppt Ollama |
| **3) Reset** | 💥 | **ALLES zurücksetzen** – Stoppt alles + deinstalliert ALLE Modelle |
| **4) Setup** | ⚙️ | Konfiguration anpassen (Modell auswählen) |
| **5) Beenden** | 🚪 | Skript schließen |

### Automatisches Setup:
- Beim ersten Start (keine Config) → **Setup-Dialog** wird automatisch angezeigt
- Beim nächsten Start → **Menü** mit allen Optionen

**💡 Tipp:** Nutze das **`Local Dev.command`** im Root-Verzeichnis für beste Desktop-Integration!

---

## 📝 Konfiguration

### `ollama-config.json`

```json
{
  "model": "llama3",          // Modell, das geladen werden soll
  "ollama": {
    "host": "localhost",      // Ollama-Host
    "port": 11434             // Ollama-Port
  }
}
```

---

## 📁 Dateistruktur

```
local-dev/
├── ollama-config.json         # Modell-Konfiguration (wird automatisch erstellt)
└── README.md                  # Diese Datei
```

**Haupt-Skript im Root-Verzeichnis:**
- `Local Dev.command` → **All-in-One** Skript mit Menü für Setup, Start/Stop und Reset

**Hinweis:** Die alten Skripte `ollama-opencode.command` und `reset-ollama.command` sind noch vorhanden für Kompatibilität, werden aber nicht mehr benötigt.

---

## ⚙️ Anforderungen

- **Ollama** muss installiert sein (`which ollama` im Terminal testen)
  → [Installationsanleitung](https://ollama.com)

- **OpenCode** muss in `/Applications/` oder `~/Applications/` installiert sein

---

## 📊 Logging

Alle Aktionen werden in **`ollama-opencode.log`** protokolliert.

---

## 🔧 Problembehebung

### Ollama startet nicht
- Prüfe, ob Ollama installiert ist: `ollama --version`
- Starte Ollama manuell: `ollama serve`

### Modell kann nicht geladen werden
- Prüfe, ob das Modell existiert: `ollama list`
- Lade das Modell manuell: `ollama pull llama3`

### OpenCode startet nicht
- Prüfe, ob die App in `/Applications/OpenCode.app` existiert
- Starte OpenCode manuell und prüfe die Konfiguration
