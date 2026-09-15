# VibeCode Workspace - Modulares System

Ein **modulares macOS-System** für Entwickler, das **Workspaces, Remote-Management und lokale KI-Entwicklung** kombiniert.

Jedes Modul ist **unabhängig nutzbar** – du kannst genau die Features behalten, die du brauchst.

---

## 🚀 Quick-Launch-Buttons (für den Schreibtisch)

Erzeuge für diese Dateien einen **Finder-Alias** auf dem Schreibtisch und starte sie per Doppelklick:

| Datei | Modul | Zweck |
|-------|-------|-------|
| `Setup Workspace.command` | Workspaces | Repository-Ordner einrichten |
| `Launch Workspace.command` | Workspaces | Workspace mit Terminals starten |
| `Local Dev.command` | Local Dev | Profil starten: MLX/Ollama → OpenCode/Codex/Claude Code |

**Wichtig:** Nutze **Aliase** (Rechtsklick → Alias erzeugen), damit die Starter ihre Module finden und Updates automatisch übernehmen.

---

## 📚 Module Übersicht

### 1️⃣ **Workspaces** (`workspaces/`)
**Zweck:** Mehrere Repository-Workspaces in VS Code / Cursor / OpenCode verwalten

| Feature | Beschreibung |
|---------|-------------|
| **Multi-Repo Workspace** | Mehrere Projekte in einem Fenster |
| **Terminal-Management** | Automatische Terminals pro Projekt |
| **Farbcodierung** | Unterschiedliche Farben pro Ordner |
| **Agenten-Integration** | Claude Code, Codex, Antigravity |
| **Wachhalten** | Verhindert macOS-Ruhezustand |
| **🆕 Split-Screen-Tabs** | VS Code mit vordefiniertem Tab-Layout |
| **🆕 Auto-Open URLs** | Browser-Tabs für localhost-Adressen |

**Hauptdateien:**
- `workspace` – Einstiegspunkt (leitet an Remote oder Workspace weiter)
- `VibeCode Workspace.command` – Hauptskript für Workspace-Launch
- `Setup VibeCode Workspace.command` – Setup-Assistent
- `terminal-setup.js` – Terminal-Konfiguration
- `config.example.zsh` – Konfigurationsvorlage

---

### 2️⃣ **Remote Management** (`remote/`)
**Zweck:** Fernverwaltung von Servern (Wake-on-LAN, SSH, Status-Check)

| Feature | Beschreibung |
|---------|-------------|
| **Wake-on-LAN** | Weckt Server per Magic Packet |
| **SSH-Verwaltung** | Einfache SSH-Verbindungen zu mehreren Servern |
| **Port-Forwarding** | Leitet Ports für Remote-Zugriff weiter |
| **Status-Monitoring** | Prüft, ob Server erreichbar sind |

**Hauptdateien:**
- `remote.py` – Hauptskript für Remote-Funktionen
- `remote.example.json` – Beispiel-Konfiguration für Server

---

### 3️⃣ **Local Dev** (`local-dev/`)
**Zweck:** Austauschbare lokale KI-Provider mit einem Terminal-Framework verbinden

| Feature | Beschreibung |
|---------|-------------|
| **Providerprofile** | MLX, Ollama und eigene kompatible APIs |
| **Freie Modellwahl** | Spark, Gemma, Qwen oder andere Backend-Modelle |
| **Frameworkprofile** | OpenCode, Codex, Claude Code und eigene Clients |
| **Sitzungsisolation** | Keine Änderung globaler Logins oder Abo-Konfigurationen |

**Hauptdateien:**
- `Local Dev.command` – Doppelklick-Starter
- `local-dev/launcher.zsh` – profilbasierter Startablauf
- `local-dev/local-ai.example.json` – vollständige Konfigurationsvorlage

---

## 🗑️ Module entfernen, die du nicht brauchst

Du kannst **jederzeit Module löschen**, die du nicht benötigst:

```bash
# Beispiel: Nur Workspaces behalten
rm -rf remote/ local-dev/

# Beispiel: Nur Local Dev behalten
rm -rf workspaces/ remote/

# Beispiel: Nur Remote Management behalten
rm -rf workspaces/ local-dev/
```

**⚠️ Wichtig:**
- Die Module sind **völlig unabhängig** – Löschen eines Moduls beeinträchtigt die anderen nicht
- **Keine Abhängigkeiten** zwischen den Modulen
- Jedes Modul hat seine **eigene Dokumentation** (README.md im Ordner)

---

## 🚀 Zentrales Setup-Skript

Führe **`workspaces/Setup VibeCode Workspace.command`** aus, um:

1. **Repository-Ordner** auszuwählen
2. **Terminals pro Projekt** zu konfigurieren
3. **Agenten (Claude, Codex, etc.)** einzurichten
4. **Standard-Terminals** festzulegen

**Verfügbare Optionen:**
```bash
# Vollständiges Setup
./workspaces/Setup\ VibeCode\ Workspace.command

# Nur Ordner hinzufügen
./workspaces/Setup\ VibeCode\ Workspace.command --add /Pfad/zum/Projekt

# Ordner ersetzen
./workspaces/Setup\ VibeCode\ Workspace.command --replace /Pfad1 /Pfad2

# Nur Terminals anpassen
./workspaces/Setup\ VibeCode\ Workspace.command --terminals

# Remote-Management konfigurieren
./workspaces/Setup\ VibeCode\ Workspace.command --remote
```

---

## 🔧 Modul-spezifische Konfiguration

### Workspaces (`workspaces/`)
| Datei | Zweck |
|-------|-------|
| `config.example.zsh` | Kopiere nach `config.local.zsh` für lokale Einstellungen |
| `terminal-setup.js` | Terminal-Farben, Prompt, Aliases anpassen |

**Beispiel-Konfiguration (`config.local.zsh`):**
```zsh
# ========== TERMINAL-EINSTELLUNGEN ==========
TERMINAL_THEME="Dracula"
TERMINAL_FONT_SIZE=14

# ========== STANDARD-TERMINALS ==========
# Format: "Anzeigename|Befehl|Arbeitsverzeichnis"
AUTO_TERMINALS=(
  "Frontend|npm run dev|frontend"
  "Backend|npm run server|backend"
)

# ========== AUTO-OPEN URLs (Browser-Tabs) ==========
# URLs, die automatisch beim Workspace-Start geöffnet werden
AUTO_OPEN_URLS=(
  "http://localhost:3000"    # Dev-Server
  "http://localhost:6006"    # Storybook
  "http://localhost:5173"    # Vite
)

# ========== SPLIT-SCREEN LAYOUT ==========
# Wie VS Code die Terminals anordnen soll
# Optionen: "tabs" (Standard) | "split" (2 Spalten) | "grid" (4 Felder)
VSCODE_TERMINAL_LAYOUT="split"

# ========== WACHHALTEN ==========
# Kontrollterminal integriert in VS Code starten und macOS-Starter schließen
OPEN_CONTROL_TERMINAL=true
CLOSE_LAUNCHER_TERMINAL=true
```

**💡 Split-Screen in VS Code (manuell):**
| Aktion | Shortcut (macOS) |
|--------|------------------|
| Vertikaler Split | `⌘ + \` |
| Horizontaler Split | `⌘ + Alt + \` |
| Zwischen Gruppen wechseln | `⌘ + [1-9]` |
| Terminal Split | `⌘ + \` (im Terminal-Fokus) |

**📌 Tipp:** Die `AUTO_TERMINALS` und `AUTO_OPEN_URLS` Konfigurationen sind **unabhängig voreinander** – du kannst beides kombinieren!

---

### Remote Management (`remote/`)
| Datei | Zweck |
|-------|-------|
| `remote.example.json` | Kopiere nach `remote.json` und trage deine Server ein |

**Beispiel-Konfiguration (`remote.json`):**
```json
{
  "servers": [
    {
      "name": "Mein Server",
      "host": "192.168.1.100",
      "mac": "00:11:22:33:44:55",
      "wake_on_lan": true,
      "ssh_port": 22,
      "user": "benutzer"
    }
  ]
}
```

**Usage:**
```bash
# Server wecken
python3 remote/remote.py --wake "Mein Server"

# Alle Server prüfen
python3 remote/remote.py --check-all

# SSH-Verbindung
python3 remote/remote.py --ssh "Mein Server"
```

---

### Local Dev (`local-dev/`)
| Datei | Zweck |
|-------|-------|
| `local-ai.json` | Persönliche Auswahl von Provider, Modell und Framework |
| `local-ai.example.json` | Versionierte Vorlage mit MLX-, Ollama- und Frameworkprofilen |

**Usage:**
- **Doppelklick auf `Local Dev.command`** → Provider starten, Modell laden und Framework öffnen
- `./Local\ Dev.command --setup` → Provider, freies Modell und Framework auswählen

---

## 📋 Schnellstart-Anleitung

### 1️⃣ Alles behalten (Vollständige Installation)
```bash
# Im Finder für die drei .command-Dateien jeweils:
# Rechtsklick → Alias erzeugen → Alias auf den Schreibtisch ziehen

# Setup ausführen (per Doppelklick oder CLI)
./Setup\ Workspace.command

# Lokale KI einrichten (optional)
./Local\ Dev.command --setup

# Remote-Server einrichten (optional)
# Kopiere remote/remote.example.json nach remote/remote.json und passe an
```

### 2️⃣ Nur Workspaces nutzen
```bash
# Quick-Launch-Buttons auf den Schreibtisch:
cp Setup\ Workspace.command ~/Desktop/
cp Launch\ Workspace.command ~/Desktop/

# Module entfernen, die du nicht brauchst
rm -rf remote/ local-dev/

# Setup ausführen
./Setup\ Workspace.command
```

### 3️⃣ Nur Local Dev nutzen
```bash
# Im Finder einen Alias von Local Dev.command auf den Schreibtisch ziehen

# Module entfernen, die du nicht brauchst
rm -rf workspaces/ remote/

# Doppelklick auf Local\ Dev.command
```

### 4️⃣ Nur Remote Management nutzen
```bash
# Module entfernen, die du nicht brauchst
rm -rf workspaces/ local-dev/

# Server konfigurieren
cp remote/remote.example.json remote/remote.json
# Anpassen und nutzen
python3 remote/remote.py --wake server1
```

---

## 🔍 Dateistruktur

```
vibecode-workspace/
├── README.md                    # Diese Datei – Modul-Übersicht
├── .gitignore                  # Git-Ignore-Regeln
│
├── Setup Workspace.command     # ⭐ Quick-Launch: Setup-Assistent
├── Launch Workspace.command    # ⭐ Quick-Launch: Workspace starten
├── Local Dev.command           # ⭐ Quick-Launch: Provider + Modell + Framework
│
├── workspaces/                 # Modul 1: Workspace-Management
│   ├── workspace               # Einstiegspunkt
│   ├── VibeCode Workspace.command
│   ├── Setup VibeCode Workspace.command
│   ├── terminal-setup.js
│   └── config.example.zsh
│
├── remote/                    # Modul 2: Remote-Management
│   ├── remote.py
│   └── remote.example.json
│
└── local-dev/                  # Modul 3: Lokale KI-Entwicklung
    ├── launcher.zsh
    ├── local-ai.example.json
    ├── local-ai.schema.json
    └── README.md
```

---

## 🛠️ Anforderungen

### Workspaces
- macOS
- VS Code oder Cursor (optional: Claude Code, Codex, Antigravity)
- Node.js (für `terminal-setup.js`)
- **Split-Screen:** Funktioniert mit allen modernen VS Code Versionen (1.80+)

### Remote Management
- Python 3.x
- Network-Tools (`ping`, `arp`, `nc`)

### Local Dev
- Zsh, `curl` und `jq`
- Das Programm des gewählten Providerprofils, z. B. MLX-LM oder Ollama
- Der gewählte Terminal-Client, z. B. `opencode`, `codex` oder `claude`

---

## 📝 Konfigurationsdateien

| Datei | Ort | Zweck |
|-------|-----|-------|
| `config.local.zsh` | `workspaces/` | Lokale Workspace-Einstellungen |
| `remote.json` | `remote/` | Server-Konfiguration |
| `local-ai.json` | `local-dev/` | Lokaler Provider, Modell, Endpoint und Framework |

**⚠️ Wichtig:**
- Alle `*.example.*`-Dateien sind **Beispiele** – kopiere sie und passe sie an
- `.gitignore` schützt deine lokalen Konfigurationen

---

## 🎯 Nächste Schritte

1. **Module auswählen** – Entscheide, welche du brauchst
2. **Unnötige löschen** – `rm -rf modulname/`
3. **Konfiguration anpassen** – Kopiere `*.example.*`-Dateien und passe sie an
4. **Setup ausführen** – Starte das zentrale Setup-Skript

---

## 💡 Tipps

- **Modularität:** Jedes Modul funktioniert **ständig allein**
- **Keine Konflikte:** Die Module stören sich nicht gegenseitig
- **Einfache Updates:** Git-Pulls aktualisieren nur die Module, die du behältst
- **Wiederherstellen:** Einfach das Repository neu klonen, wenn du ein Modul zurückholen willst
- **🔧 Split-Screen:** Nutze `VSCODE_TERMINAL_LAYOUT` in `config.local.zsh` für automatische Terminal-Anordnung
- **🌐 Auto-URLs:** Definiere `AUTO_OPEN_URLS` in `config.local.zsh`, um Browser-Tabs automatisch zu öffnen

---

## 📞 Hilfe & Fehlerbehebung

### Workspaces
- **Starter öffnet sich als Text:** Rechtsklick → Öffnen im Finder
- **Keine Repositories:** `Setup VibeCode Workspace.command` ausführen
- **VS Code nicht gefunden:** VS Code oder Cursor in `/Applications` installieren

### Remote Management
- **Python fehlt:** `brew install python`
- **Server nicht erreichbar:** IP-Adresse und MAC-Adresse prüfen

### Local Dev
- **Ollama nicht installiert:** [ollama.com](https://ollama.com)
- **Modell lädt nicht:** `ollama pull modellname` manuell ausführen
- **OpenCode nicht gefunden:** App in `/Applications` installieren

---

**Viel Erfolg mit deinem modularen VibeCode Workspace! 🚀**
