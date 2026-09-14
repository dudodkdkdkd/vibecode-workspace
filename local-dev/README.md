# Local Dev - OpenCode + Ollama

Ein **Doppelklick-Skript** für macOS, das OpenCode automatisch mit lokalem Ollama verbindet.

---

## 🚀 Schnellstart

1. **Ordner auf den Desktop kopieren**
   ```bash
   cp -r /Pfad/zum/vibecode-workspace/local-dev ~/Desktop/
   ```

2. **Modell in der Konfiguration anpassen (optional)**
   - Öffne `ollama-config.json`
   - Ändere das Feld `"model"` zu deinem Wunschmodell (z. B. `"mistral:7b"`, `"phi3"`, `"llama3"`)

3. **Per Doppelklick auf `ollama-opencode.command` starten**

---

## 🔄 Funktionsweise

| Aktion | Beschreibung |
|--------|-------------|
| **🟢 1. Doppelklick** | Startet Ollama → Lädt Modell → Konfiguriert OpenCode → Startet OpenCode |
| **🔴 2. Doppelklick** | Stoppt OpenCode → Entfernt Modell aus RAM → Stoppt Ollama |

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
