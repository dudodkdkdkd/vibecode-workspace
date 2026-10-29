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
| **Remote-Workspaces per SSH** | Remote-Repositories mit Agent-Terminals und Git-Ansicht; ein Fenster pro Host |
| **Terminal-Management** | Automatische Terminals pro Projekt |
| **Farbcodierung** | Unterschiedliche Farben pro Ordner |
| **Agenten-Integration** | Claude Code, Codex, Antigravity |
| **Wachhalten** | Verhindert macOS-Ruhezustand |
| **🆕 Split-Screen-Tabs** | VS Code mit vordefiniertem Tab-Layout |
| **🆕 Auto-Open URLs** | Browser-Tabs pro Workspace, im Setup-Assistenten festgelegt |

**Hauptdateien:**
- `workspace` – Einstiegspunkt (leitet an Remote oder Workspace weiter)
- `VibeCode Workspace.command` – Hauptskript für Workspace-Launch
- `project-selection.js` – Projektauswahl mit einzeln anklickbaren Checkboxen
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
5. **Browser-Tabs pro Projekt** festzulegen (z. B. `http://localhost:5173`, `http://localhost:6006` für Storybook)

Beim Start über **`Launch Workspace.command`** die gewünschten Projekte anhaken und
**Öffnen** klicken. Für mehrere Projekte ist keine ⌘-Taste erforderlich.
Die Liste wird bei jedem Start um Git-Repositories direkt in den Elternordnern der
eingerichteten Projekte ergänzt. Neue oder umbenannte Repositories erscheinen so
automatisch; nicht mehr vorhandene Pfade werden ausgeblendet. Weitere Elternordner
werden über ein Projekt im Setup bekannt gemacht.

**Verfügbare Optionen:**
```bash
# Vollständiges Setup
./workspaces/Setup\ VibeCode\ Workspace.command

# Nur Ordner hinzufügen
./workspaces/Setup\ VibeCode\ Workspace.command --add /Pfad/zum/Projekt

# Remote-Repository hinzufügen (ohne lokalen Checkout)
./workspaces/Setup\ VibeCode\ Workspace.command --add-remote spark /home/user/projects/app

# SSH-Host hinzufügen und Repositories automatisch finden
./workspaces/Setup\ VibeCode\ Workspace.command --add-remote-host spark '~/projects'

# SSH-Verbindung geführt einrichten und testen
./workspaces/Setup\ VibeCode\ Workspace.command --connect-remote

# Ordner ersetzen
./workspaces/Setup\ VibeCode\ Workspace.command --replace /Pfad1 /Pfad2

# Nur Terminals anpassen
./workspaces/Setup\ VibeCode\ Workspace.command --terminals

# Remote-Management konfigurieren
./workspaces/Setup\ VibeCode\ Workspace.command --remote
```

### Remote arbeiten: Codex, Claude und Git auf demselben Server

**Einfachster Einstieg: „Remote-Verbindung einrichten“** im Setup wählen. Der Assistent läuft im geöffneten Terminal und bietet bestehende SSH-Verbindungen aus `~/.ssh/config` (einschließlich eingebundener Dateien) zur Auswahl an. Für eine neue Verbindung gibst du nur `benutzer@adresse`, einen Namen, den SSH-Port (normalerweise `22`) und optional den Repository-Suchordner an. Ein vorhandener SSH-Schlüssel lässt sich auswählen; bei Bedarf erzeugt der Assistent einen eigenen Ed25519-Schlüssel und hinterlegt dessen öffentlichen Teil auf dem Server.

Der Assistent ergänzt die SSH-Konfiguration so, dass **VS Code und Repository-Suche dieselbe Verbindung verwenden**. Vorher legt er eine Sicherung `~/.ssh/config.vibecode-backup-…` an; vorhandene Verbindungen bleiben erhalten. Passwörter und Schlüssel-Passphrasen werden direkt von OpenSSH im Terminal abgefragt und nicht in den Workspace-Einstellungen gespeichert. Auf macOS wird der gewählte Schlüssel mit `ssh-add --apple-use-keychain` geladen. Die [SSH-Konfiguration](https://man.openbsd.org/ssh_config) enthält dafür einen eigenen Host-Eintrag.

Erst wenn die Anmeldung ohne Passwortabfrage und die Repository-Suche funktionieren, wird der Host für automatische Starts aktiviert. Der Server muss über das Netzwerk (gegebenenfalls VPN/Tailscale) erreichbar sein und SSH anbieten. Beim ersten Kontakt bestätigt man den Host-Fingerabdruck in der normalen SSH-Abfrage. Der Benutzer benötigt zum Hinterlegen des öffentlichen Schlüssels zunächst einen funktionierenden SSH-Zugang, beispielsweise per Server-Passwort. Bei Fehlern bleiben angelegte Schlüssel und SSH-Einträge für die Reparatur verfügbar; der Host wird noch nicht automatisch gestartet. Agenten wie Codex oder Claude müssen weiterhin auf dem Server installiert und angemeldet werden.

**Alle Repositories eines Hosts automatisch anzeigen:** Im Setup **„Remote-Host hinzufügen“** wählen, den SSH-Host (z. B. `spark`) und optional einen Suchordner wie `~/projects` angeben. Leer lassen = Home-Verzeichnis auf dem Server. Der Launcher durchsucht den Ordner bei jedem Start rekursiv und zeigt die gefundenen Git-Repositories und Git-Worktrees mit `[SSH: spark]` in der Projektauswahl an. Neue Repositories kommen automatisch hinzu; nach einer erfolgreichen Suche verschwinden gelöschte wieder. Abhängigkeits- und Cache-Ordner wie `node_modules`, `.venv`, `.cache` und die macOS-`Library` werden übersprungen; Verzeichnis-Symlinks werden nicht verfolgt.

Beim Einrichten können SSH-Anmeldedialoge im Terminal erscheinen. Für die automatische Suche beim Start sollte die Anmeldung per SSH-Schlüssel oder SSH-Agent funktionieren. Nicht erreichbare Hosts blockieren die lokalen Projekte nicht: Die zuletzt gefundene Liste wird weiter angezeigt. Nach unvollständigen Suchen (z. B. fehlenden Leserechten) bleiben bisher bekannte Repositories erhalten. Auf dem Server braucht die Suche nur `sh` und `find`; Python läuft auf dem Mac.

Die Hosts liegen in `~/.config/vibecode-workspace/remote-hosts.json`, die letzte Repository-Liste in `remote-repositories.json`. Zum Ändern des Suchordners denselben Host erneut hinzufügen. Über **„Terminals ändern“** lassen sich auch die automatisch gefundenen Repositories konfigurieren; ohne eigene Auswahl gelten die Standard-Terminals. `--check` liest ausschließlich den Cache und stellt keine SSH-Verbindung her.

**Ein einzelnes Repository gezielt eintragen:**

1. **`Setup Workspace.command`** öffnen und **„Remote-Repository hinzufügen“** wählen.
2. Den **SSH-Hostalias** (z. B. `spark` aus `~/.ssh/config`, alternativ `user@host`) und den **absoluten Repository-Pfad auf dem Server** eingeben. Port, Schlüssel und ProxyJump werden über die SSH-Konfiguration festgelegt.
3. Im anschließenden Terminal-Setup das neue Projekt auswählen und Codex, Claude Code, Shells oder eigene Befehle konfigurieren. Unterordner wie `frontend` beziehen sich auf den Server; bei einem Projekt ohne diesen Unterordner das Arbeitsverzeichnis leer lassen.
4. **`Launch Workspace.command`** starten und das Remote-Projekt anhaken. Der Launcher installiert bei Bedarf **Remote - SSH** in VS Code; VS Code übernimmt Verbindung und Anmeldung. Beim ersten Start den Workspace als vertrauenswürdig bestätigen, damit Agent-Terminals starten.

Das Repository muss bereits auf dem Server liegen. Dort müssen Git, `/bin/bash` und die gewählten Agent-CLIs installiert und im Login-PATH erreichbar sein. Codex-/Claude-Logins und die beiden Codex-Profile (`~/.codex`, `~/.codex-account2`) werden auf dem Server eingerichtet. Unterstützt werden Linux- und macOS-SSH-Hosts. Ein lokaler Checkout ist für ein Remote-Projekt nicht erforderlich.

VS Code öffnet die **Remote-Dateien**: Änderungen der Agenten erscheinen dadurch in der normalen **Quellcodeverwaltung/Git-Ansicht** dieses Fensters, einschließlich Diffs, Staging und Commits. Das entspricht dem [VS-Code-Modell für Remote SSH](https://code.visualstudio.com/docs/remote/ssh).

Lokale Projekte öffnen zusammen in einem lokalen Fenster; Remote-Projekte werden **pro SSH-Host** in einem weiteren Fenster zusammengefasst. Dasselbe Repository lässt sich als lokales und als Remote-Projekt getrennt eintragen und auswählen. Die Workspace-Dateien liegen unter `~/.vibe-workspaces/`, für SSH z. B. `Vibe-Session-SSH-spark.code-workspace`. Das macOS-Kontrollterminal für Wachhalten und Apps startet nur im lokalen Workspace; es ist separat über „Wachhalten & Apps“ erreichbar.

Browser-Tabs werden wie bisher pro Projekt konfiguriert. Remote-URLs wie `http://localhost:5173` werden über [VS Codes Portweiterleitung](https://code.visualstudio.com/api/advanced-topics/remote-extensions#forwarding-localhost) in den eingebetteten Tab geladen. So dürfen mehrere Hosts denselben Server-Port nutzen. Die gebündelte Erweiterung läuft lokal und wird durch den Launcher installiert; eine separate Installation dieser Erweiterung auf dem Server ist nicht erforderlich.

Für einen Start ohne Setup-Dialoge gibt es `--add-remote SSH-Host /Repo-Pfad [Anzeigename]`; dabei gelten zunächst die fünf Standard-Terminals. Anschließend lassen sich über **„Terminals ändern“** die Agenten, Unterordner und URLs anpassen. Projekte werden weiterhin in `projects.tsv` gespeichert (Remote-Pfade als `vscode-remote://ssh-remote+…`); `terminals.json` bleibt mit Version 1 und 2 kompatibel.

Alternativ registriert `--add-remote-host SSH-Host [Suchordner]` einen Host mit automatischer Suche. Ohne Suchordner wird das Remote-Home-Verzeichnis verwendet. `~/projects` beim CLI-Aufruf in Anführungszeichen setzen, damit die lokale Shell es unverändert übergibt.

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
  "Storybook|npm run storybook -- --no-open|frontend"
  "Claude|claude --dangerously-skip-permissions|"
  'Codex 1|CODEX_HOME="$HOME/.codex" codex --dangerously-bypass-approvals-and-sandbox|'
  'Codex 2|CODEX_HOME="$HOME/.codex-account2" codex --dangerously-bypass-approvals-and-sandbox|'
)
AUTO_START_TERMINALS=true
# Globale Terminals für jedes Projekt; Browser-Tabs bleiben projektspezifisch.
# true = stattdessen projektspezifische Terminal-Auswahl aus dem Setup verwenden.
USE_PROJECT_TERMINALS=false

# ========== AUTO-OPEN URLs (Browser-Tabs) ==========
# Browser-Tabs werden NICHT hier, sondern pro Projekt im Setup-Assistenten
# festgelegt: `Setup VibeCode Workspace.command` → Projekt auswählen →
# nach den Terminals nach den gewünschten URLs fragen (Komma-getrennt).
# Gespeichert in ~/.config/vibecode-workspace/terminals.json.

# ========== SPLIT-SCREEN LAYOUT ==========
# Wie VS Code die Terminals anordnen soll
# Optionen: "tabs" (Standard) | "split" (2 Spalten) | "grid" (4 Felder)
VSCODE_TERMINAL_LAYOUT="split"

# ========== WACHHALTEN ==========
# Kontrollterminal integriert in VS Code starten und macOS-Starter schließen
OPEN_CONTROL_TERMINAL=true
CLOSE_LAUNCHER_TERMINAL=true
```

Die feste Startreihenfolge ist Frontend (`npm run dev`), Storybook, Claude,
Codex 1 und Codex 2. Die Erweiterung legt die Terminals nacheinander an und startet
ihre Befehle direkt beim Öffnen; laufende Server bleiben aktiv.
Pro Projekt erscheinen die fünf Terminals in einer gemeinsamen Split-Ansicht,
von links nach rechts in dieser Reihenfolge. Die Erweiterung fügt jedes Terminal
rechts neben seinem Vorgänger ein; jedes Projekt behält seine eigene Farbe.
Nach dem Beenden eines Befehls oder einem Abbruch mit `Ctrl+C` bleibt im selben
Terminal eine Shell geöffnet. Der Befehl kann dort erneut gestartet werden.
Der Starter installiert die gebündelte Erweiterung bei jedem Start regulär im
gewählten Editor, damit auch eine zuvor deinstallierte Version wieder aktiviert wird.
Die Codex-Profile liegen getrennt in `~/.codex` und
`~/.codex-account2` und starten mit vollem Zugriff ohne Sandbox und ohne
Bestätigungsabfragen (`--dangerously-bypass-approvals-and-sandbox`).
Ohne `frontend`-Unterordner starten die Standard-Terminals im
Repository-Ordner. Dev- und Storybook-Server benötigen dort passende npm-Skripte.

**💡 Split-Screen in VS Code (manuell):**
| Aktion | Shortcut (macOS) |
|--------|------------------|
| Vertikaler Split | `⌘ + \` |
| Horizontaler Split | `⌘ + Alt + \` |
| Zwischen Gruppen wechseln | `⌘ + [1-9]` |
| Terminal Split | `⌘ + \` (im Terminal-Fokus) |

**📌 Tipp:** `AUTO_TERMINALS` und die Browser-Tabs sind **unabhängig voneinander** – du kannst beides kombinieren!

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
- **Doppelklick auf `Local Dev.command`** → Verfuegbarkeitsbaum ansehen, Repository, Hosting, Modell und kompatible CLI waehlen
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
# Rechtsklick auf die Datei → "Alias erzeugen" → Alias auf den Schreibtisch ziehen.
# Keine Kopie anlegen: die Starter finden ihr Modul über ihren eigenen Ort.

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
