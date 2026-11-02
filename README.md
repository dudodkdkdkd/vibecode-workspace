# VibeCode Workspace - Modulares System

Ein **modulares macOS-System** für Entwickler, das **Workspaces, Remote-Management und lokale KI-Entwicklung** kombiniert.

Jedes Modul ist **unabhängig nutzbar** – du kannst genau die Features behalten, die du brauchst.

---

## 🚀 Quick-Launch-Buttons (für den Schreibtisch)

Im Hauptordner gibt es genau **eine** Datei zum Starten: `VibeCode Workspace.command` öffnet das Hauptfenster.
Alles andere (Setup, Projekte auswählen, Remote, Local Dev, SSH) erreichst du dort.

> **Zwei Dateien heißen `VibeCode Workspace.command`:** Die im Hauptordner ist **die App** (das Fenster).
> Die in `workspaces/` ist der **Launcher** darunter (Projekte auswählen und in VS Code öffnen); du erreichst
> ihn über **Projekte & Module → Projekte auswählen und starten**, nie direkt.

Für einen Schreibtisch-Knopf zur App selbst: Rechtsklick auf `VibeCode Workspace.command` → **Alias erzeugen** → auf den
Schreibtisch ziehen (nie kopieren: der Starter findet seine Module über seinen eigenen Ort).
Für einzelne **Workspaces** legt die App den Schreibtisch-Alias selbst an (siehe unten).

---

## 🪟 VibeCode Workspace (Grundapp)

Eine App für alles: Doppelklick auf `VibeCode Workspace.command` öffnet die **Übersicht**. Sie zeigt alles auf einen Blick,
nichts ist hinter einem Menü versteckt, und jede Zeile hat ihren Status und ihren eigenen Knopf:

| Bereich | Was du siehst | Knöpfe |
|---------|---------------|--------|
| **Workspaces** | jeder gespeicherte Workspace mit Projekten und Schreibtisch-Shortcut (⚠︎ wenn ein Projekt fehlt) | **Starten**, **Bearbeiten…**, **Neuer Workspace…**, **Shortcuts erneuern** |
| **Repository-Suche** | alle Ordner, in denen VibeCode nach Git-Repositories sucht, lokal und auf SSH-Hosts, mit Zahl der Funde | **Ordner hinzufügen…**, **Remote-Ordner hinzufügen…**, **Entfernen** |
| **Presets pro Repository** | welche Terminals und Browser-Tabs je Repository starten; Presets von verschobenen Repositories | **Bearbeiten…**, **Zurücksetzen**, **Übernehmen**, **Preset anlegen…** |
| **SSH** | deine SSH-Hosts mit Zahl der gefundenen Repositories, dazu der gespeicherte Mac (siehe unten) | **Verbinden**, **Neue Verbindung…**, **Diesen Mac freigeben…** |
| **Projekte & Module** | Projekte auswählen, Setup, Remote, Local Dev, jeweils mit Status (z. B. „12 Projekte eingerichtet“, „Wachhalten AUS · Apps: Codex, Claude“, „MLX · Spark-X2.5-4B → opencode“) | **Öffnen** |

Der Punkt vor einer Zeile zeigt den Zustand: grün = eingerichtet und in Ordnung, orange = braucht Aufmerksamkeit
(z. B. keine Projekte gefunden), grau = aus oder nicht eingerichtet. **Öffnen** und **Verbinden** starten das Ziel im
Terminal und schließen die Übersicht. Jedes Modul meldet seinen Status selbst (siehe `module.json`).

Ein **Workspace** ist eine benannte Auswahl von Projekten, z. B. „Demo“ = example-api + example-web + example-docs.
Mit dem Häkchen **Shortcut auf dem Schreibtisch** legt VibeCode alles Nötige selbst an:
einen kleinen Starter in `~/.config/vibecode-workspace/shortcuts/` und einen **Finder-Alias** mit dem
Namen des Workspaces auf dem Schreibtisch. Ein Doppelklick startet den Workspace direkt.

- Umbenennen, Häkchen entfernen oder Löschen aktualisiert den Alias mit.
- Eine fremde Datei mit demselben Namen auf dem Schreibtisch wird **nie** überschrieben oder gelöscht;
  stattdessen gibt es eine Fehlermeldung und nichts wird gespeichert.
- Verschiebst du das Repository, öffne die App einmal aus dem neuen Ordner: die Shortcuts finden es dann wieder.
- Beim ersten Shortcut kann macOS einmal nach dem Zugriff auf den Schreibtisch-Ordner fragen.
- Workspaces speichern Projekt-*Namen*, nicht Pfade. Fehlt ein Projekt, warnt das Fenster, und der Shortcut
  zeigt einen Alarm statt still nichts zu tun.
- Kennt der Launcher noch keine Projekte, zeigt die Zeile „Repository-Ordner, Terminals und URLs einrichten“ einen orangen Punkt: dort **Öffnen**.

### Repository-Suche: Ordner hinzufügen, lokal oder remote

Statt jedes Repository einzeln einzutragen, gibst du **Ordner** an, in denen VibeCode sucht:

- **Ordner hinzufügen…** öffnet die Ordnerwahl (mehrere Ordner auf einmal sind möglich). VibeCode durchsucht den Ordner bis zu
  4 Ebenen tief und findet Repositories und Git-Worktrees. Versteckte Ordner, `node_modules`, `.venv`, `venv`, `.cache`,
  `Library` und verlinkte Ordner werden übersprungen; in einem gefundenen Repository wird nicht weiter gesucht. Ist ein Ordner
  riesig (Home-Verzeichnis, `/`), bricht die Suche ab und sagt es.
- **Remote-Ordner hinzufügen…** fragt nach **SSH-Host** (Alias aus `~/.ssh/config` oder `benutzer@host`) und **Ordner auf dem Server**
  (leer = Home). Auf dem Server wird rekursiv gesucht, wie beim Setup. Die Suche läuft ohne Passwortabfrage; klappt die Anmeldung
  noch nicht, bleibt der Host gespeichert, und das Fenster verweist auf **SSH → Neue Verbindung… → Geführte Einrichtung**.
- **Entfernen** beendet nur die Suche. Repositories, Platte und Server bleiben unberührt; Workspaces mit Projekten daraus zeigen
  danach ⚠︎.

Der Launcher durchsucht die Ordner bei jedem Start und zeigt die Funde in der Projektauswahl; die Übersicht selbst fragt **keinen
Host per SSH** an, sie zeigt den zuletzt gefundenen Stand. Lokale Ordner stehen in `~/.config/vibecode-workspace/search-folders.json`,
Remote-Hosts in `remote-hosts.json`. Auch im Terminal: `./VibeCode\ Workspace.command folders list | add PFAD | remove PFAD | add-remote HOST [ORDNER] | remove-remote HOST`.

### Presets: pro Repository eine Konfiguration

Ein **Preset** legt fest, welche **Terminals** (Shell, Claude Code, Codex, Codex 2, Antigravity oder ein eigener Befehl, je mit
Name und Unterordner) und welche **Browser-Tabs** für ein Repository starten. Es ist dieselbe Konfiguration wie bei „Terminals ändern“
im Setup (`terminals.json`), nur im Fenster:

- **Preset anlegen…** wählt ein Repository und öffnet das Formular. Ohne Preset startet es mit den **Standard-Terminals**
  (Frontend, Storybook, Claude, Codex 1, Codex 2), also mit dem, was dort heute wirklich läuft. Typ „–“ lässt eine Zeile aus.
- **Bearbeiten…** ändert ein vorhandenes Preset, **Zurücksetzen** bringt die Standard-Terminals zurück.
- Der Startbefehl wird vom Setup-Assistenten selbst gebaut (inklusive sicherem Quoting des Prompts); das Fenster schreibt nur
  Typ, Name, Prompt und Unterordner. Ein ungültiges Preset (z. B. Unterordner mit `..`, Browser-Tab ohne `http://`) wird mit
  Grund abgelehnt, deine Eingaben bleiben stehen. Eine beschädigte `terminals.json` wird nie ersetzt.
- **Presets hängen am Pfad des Repositories.** Verschiebst du ein Repository, gilt sein Preset nicht mehr. Die Übersicht zeigt es
  dann orange als „Repository nicht mehr gefunden“; gibt es genau ein gleichnamiges Repository am neuen Ort, überträgt
  **Übernehmen** das Preset dorthin. Das alte wird erst nach dem erfolgreichen Kopieren entfernt.
- Im Terminal: `./VibeCode\ Workspace.command presets list | save --path=PFAD --data=JSON | reset PFAD | move ALT NEU`.

### SSH im Fenster

Der Bereich **SSH** zeigt deine eingerichteten Verbindungen: die SSH-Hosts mit Repository-Suche (mit der Anzahl der zuletzt
gefundenen Repositories) und den gespeicherten Mac, z. B. der Remote-Mac. Den Bereich gibt es nur, wenn ein Modul SSH anbietet.
Die Übersicht fragt dabei **keinen Host per SSH** an, sie zeigt den zuletzt gefundenen Stand.

| Schaltfläche | Was sie tut |
|--------------|-------------|
| **Verbinden** | öffnet die gewählte Verbindung als SSH-Sitzung im Terminal |
| **Neue Verbindung…** | *Geführte Einrichtung* (Host, Schlüssel, Repository-Suche, im Terminal) oder *Mit der Zeile eines anderen Macs verbinden* (ohne Passwort) |
| **Diesen Mac freigeben…** | prüft die Entfernte Anmeldung (öffnet bei Bedarf die Systemeinstellungen), zeigt die Zeile für den anderen Mac (liegt in der Zwischenablage) und trägt dessen Schlüssel ein, nachdem du den Fingerprint bestätigt hast |

Zwischen zwei Macs, jeweils mit dieser App: auf dem **Remote-Mac** *Diesen Mac freigeben…* → Zeile kopieren; auf dem **Client-Mac**
*Neue Verbindung… → Mit der Zeile…* → einfügen → die angezeigte Zeile kopieren; zurück auf dem **Remote-Mac** *Schlüssel eintragen…* →
einfügen, Fingerprint prüfen, bestätigen; auf dem **Client-Mac** *Verbinden*. *Wach halten* startet auch die gewählten Apps
(wie `remote on`); ohne Wachhalten kann der Remote-Mac einschlafen und ist dann nicht erreichbar.

Auch ohne Fenster:

```bash
./VibeCode\ Workspace.command list                     # gespeicherte Workspaces
./VibeCode\ Workspace.command run Demo              # Workspace starten
./VibeCode\ Workspace.command save --name=Demo --project=example-api --project=example-web --shortcut
./VibeCode\ Workspace.command delete --name=Demo    # samt Schreibtisch-Shortcut
./VibeCode\ Workspace.command shortcuts sync           # alle Shortcuts neu anlegen
./VibeCode\ Workspace.command remote ssh share         # Modul-Befehle: launch, setup, remote …, local
```

**Module melden sich selbst an:** Jeder Modulordner enthält eine `module.json` mit `entries`
(`id`, `title`, `run`, optional `menu`). `{module}` steht für den Ordner des Moduls. Löschst du einen
Modulordner, verschwinden seine Einträge; ein neues Modul braucht nur einen Ordner mit `module.json`.

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
**Zweck:** Einen Mac (z. B. ein Remote-Mac) wach halten, Claude/Codex darauf laufen
lassen und sich von einem anderen Mac per SSH verbinden.

| Feature | Beschreibung |
|---------|-------------|
| **Wachhalten** | Hält den Mac per `caffeinate` wach, bis du ihn ausschaltest |
| **Plattformen / Apps** | Startet und beendet Claude, Claude Code, Codex, OpenCode mit dem Wachhalten |
| **Kontrollterminal** | Menü zum Ein-/Ausschalten und zur App-Auswahl |
| **SSH zum Remote-Mac** | Speichert das Ziel einmalig, prüft die Erreichbarkeit und verbindet |

**Hauptdateien:**
- `remote.py` – Hauptskript für Remote-Funktionen
- `remote.example.json` – Standardwerte für Wachhalten und Apps

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
- `module.json` – meldet das Modul in der VibeCode-App an (`./VibeCode\ Workspace.command local`)
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
- Die Module sind **unabhängig** – Löschen eines Moduls beeinträchtigt die anderen nicht; die Grundapp zeigt nur noch die vorhandenen
- Nur lose Verbindungen: der Launcher öffnet das Kontrollterminal nur, wenn `remote/` vorhanden ist. Workspaces starten braucht `workspaces/`
- Jedes Modul hat seine **eigene Dokumentation** (README.md im Ordner)

---

## 🚀 Zentrales Setup-Skript

Führe **`workspaces/Setup VibeCode Workspace.command`** aus, um:

1. **Repository-Ordner** auszuwählen
2. **Terminals pro Projekt** zu konfigurieren
3. **Agenten (Claude, Codex, etc.)** einzurichten
4. **Standard-Terminals** festzulegen
5. **Browser-Tabs pro Projekt** festzulegen (z. B. `http://localhost:5173`, `http://localhost:6006` für Storybook)

Beim Start über **Projekte & Module → Projekte auswählen und starten** (oder `./VibeCode\ Workspace.command launch`) die gewünschten Projekte anhaken und
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

1. In der VibeCode-App bei **Projekte & Module** die Einrichtung **öffnen** (oder `./VibeCode\ Workspace.command setup`) und **„Remote-Repository hinzufügen“** wählen.
2. Den **SSH-Hostalias** (z. B. `spark` aus `~/.ssh/config`, alternativ `user@host`) und den **absoluten Repository-Pfad auf dem Server** eingeben. Port, Schlüssel und ProxyJump werden über die SSH-Konfiguration festgelegt.
3. Im anschließenden Terminal-Setup das neue Projekt auswählen und Codex, Claude Code, Shells oder eigene Befehle konfigurieren. Unterordner wie `frontend` beziehen sich auf den Server; bei einem Projekt ohne diesen Unterordner das Arbeitsverzeichnis leer lassen.
4. Die App starten (**Starten**, oder **Projekte auswählen und starten**) und das Remote-Projekt anhaken. Der Launcher installiert bei Bedarf **Remote - SSH** in VS Code; VS Code übernimmt Verbindung und Anmeldung. Beim ersten Start den Workspace als vertrauenswürdig bestätigen, damit Agent-Terminals starten.

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
| `remote.example.json` | Standardwerte (`keep_awake`, `apps`); deine Einstellungen liegen in `~/.config/vibecode-workspace/remote/config.json` |

**Usage** (`workspace` steht hier für `./workspaces/workspace`):
```bash
workspace remote on        # Wachhalten + gewählte Apps starten
workspace remote off       # Wachhalten lösen, Apps beenden
workspace remote status    # aktuellen Zustand zeigen
workspace remote control   # Kontrollterminal (Menü)
```

#### SSH vom Client-Mac zum Remote-Mac

Zwei Sätze, ein Satz pro Gerät, kein Passwort. Jedes Gerät gibt **eine Zeile** aus, die du
zum anderen trägst (sie landet auch in der Zwischenablage, mit Universal Clipboard genügt Einfügen).

| Schritt | Auf dem … | Du sagst / tippst | Ergebnis |
|---------|-----------|-------------------|----------|
| 1 | **Remote-Mac** (gibt Zugriff) | „gib Zugriff frei“ oder `workspace remote ssh share` | prüft Entfernte Anmeldung (öffnet bei Bedarf die Einstellungen) und gibt eine `join`-Zeile aus |
| 2 | **Client-Mac** (bekommt Zugriff) | „ich will Zugriff“ + die `join`-Zeile einfügen | prüft den Fingerprint des Remote-Macs, speichert das Ziel und gibt eine `allow`-Zeile aus |
| 3 | **Remote-Mac** | die `allow`-Zeile einfügen, Fingerprint bestätigen | der Schlüssel des Client-Macs ist freigegeben |
| 4 | **Client-Mac** | `workspace remote ssh join` | `✔ Verbunden` |

`share --wake` hält den Remote-Mac zusätzlich wach (wie `workspace remote on`, startet also auch
die gewählten Apps). Ohne Wachhalten kann der Remote-Mac einschlafen, dann ist SSH nicht erreichbar.

**Danach:** `workspace remote ssh` (interaktiv) oder `workspace remote ssh run -- <befehl>`
(ohne Terminal, für Agenten; bricht sofort ab statt auf ein Passwort zu warten).

**Mit einem KI-Agenten:** Er folgt dem Skill `.agents/skills/vibecode-remote-ssh/SKILL.md`.
Er führt `share`, `join` und `allow` selbst aus; den Fingerprint bestätigst du, bevor er einen
Schlüssel freigibt. Rückgängig machen: die Zeile des Schlüssels aus `~/.ssh/authorized_keys` löschen.

Das Ziel steht in `~/.config/vibecode-workspace/remote/ssh.json`. Der Fingerprint in der
`join`-Zeile ist der Host-Schlüssel des Remote-Macs: Stimmt er nicht, wird die Verbindung abgelehnt.
Alternativ ohne Zeilen-Austausch: `workspace remote ssh set benutzer@host` und danach
`workspace remote ssh pair` (fragt einmal das Passwort des Remote-Macs).

**Von unterwegs:** `remote-mac.local` funktioniert nur im selben Netzwerk. Außerhalb
installierst du [Tailscale](https://tailscale.com) auf beiden Macs und trägst statt
`remote-mac.local` den Tailscale-Namen oder die Tailscale-IP ein.

---

### Local Dev (`local-dev/`)
| Datei | Zweck |
|-------|-------|
| `local-ai.json` | Persönliche Auswahl von Provider, Modell und Framework |
| `local-ai.example.json` | Versionierte Vorlage mit MLX-, Ollama- und Frameworkprofilen |

**Usage:**
- **VibeCode-App → Projekte & Module → Local Dev** → Verfuegbarkeitsbaum ansehen, Repository, Hosting, Modell und kompatible CLI waehlen
- `./VibeCode\ Workspace.command local --setup` → Provider, freies Modell und Framework auswählen

---

## 📋 Schnellstart-Anleitung

### 1️⃣ Alles behalten (Vollständige Installation)
```bash
# Hauptfenster öffnen (per Doppelklick oder CLI)
./VibeCode\ Workspace.command

# Setup ausführen (oder in der Übersicht: Einrichtung öffnen)
./VibeCode\ Workspace.command setup

# Lokale KI einrichten (optional)
./VibeCode\ Workspace.command local --setup

# SSH-Ziel (Remote-Mac) einrichten (optional)
./workspaces/workspace remote ssh set benutzer@remote-mac.local
```

### 2️⃣ Nur Workspaces nutzen
```bash
# Quick-Launch-Buttons auf den Schreibtisch:
# Rechtsklick auf die Datei → "Alias erzeugen" → Alias auf den Schreibtisch ziehen.
# Keine Kopie anlegen: die Starter finden ihr Modul über ihren eigenen Ort.

# Module entfernen, die du nicht brauchst
rm -rf remote/ local-dev/

# Setup ausführen
./VibeCode\ Workspace.command setup
```

### 3️⃣ Nur Local Dev nutzen
```bash
# Module entfernen, die du nicht brauchst
rm -rf workspaces/ remote/

# Starten (oder in der Übersicht: Local Dev öffnen)
./VibeCode\ Workspace.command local
```

### 4️⃣ Nur Remote Management nutzen
```bash
# Module entfernen, die du nicht brauchst
rm -rf workspaces/ local-dev/

# SSH-Ziel speichern und verbinden (ohne den workspaces/-Dispatcher direkt über remote.py)
python3 remote/remote.py ssh set benutzer@remote-mac.local
python3 remote/remote.py ssh
```

---

## 🔍 Dateistruktur

```
vibecode-workspace/
├── README.md                    # Diese Datei – Modul-Übersicht
├── .gitignore                  # Git-Ignore-Regeln
│
├── VibeCode Workspace.command            # ⭐ Der einzige Starter: öffnet das Hauptfenster
│
├── core/                       # Grundapp: Logik (vibecode.py) und Hauptfenster (window.js)
│
├── workspaces/                 # Modul 1: Workspace-Management (+ module.json)
│   ├── workspace               # Einstiegspunkt
│   ├── VibeCode Workspace.command
│   ├── Setup VibeCode Workspace.command
│   ├── terminal-setup.js       # Setup-Assistent; seine Funktionen nutzt auch presets.js
│   ├── presets.js              # Presets pro Repository lesen und schreiben
│   ├── local-folders.py        # lokale Suchordner (Gegenstück zu remote-hosts.py)
│   ├── remote-hosts.py         # SSH-Hosts mit Repository-Suche
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

### Grundapp
- macOS, Python 3 (`xcode-select --install` oder `brew install python`)

### Workspaces
- macOS
- VS Code oder Cursor (optional: Claude Code, Codex, Antigravity)
- Node.js (für `terminal-setup.js`)
- **Split-Screen:** Funktioniert mit allen modernen VS Code Versionen (1.80+)

### Remote Management
- Python 3.x
- OpenSSH (`/usr/bin/ssh`, bei macOS dabei)

### Local Dev
- Zsh, `curl` und `jq`
- Das Programm des gewählten Providerprofils, z. B. MLX-LM oder Ollama
- Der gewählte Terminal-Client, z. B. `opencode`, `codex` oder `claude`

---

## 📝 Konfigurationsdateien

| Datei | Ort | Zweck |
|-------|-----|-------|
| `config.local.zsh` | `workspaces/` | Lokale Workspace-Einstellungen |
| `config.json`, `ssh.json` | `~/.config/vibecode-workspace/remote/` | Wachhalten/Apps und SSH-Ziel |
| `workspaces.json` | `~/.config/vibecode-workspace/` | Gespeicherte Workspaces (Name, Projekte, Shortcut) |
| `search-folders.json` | `~/.config/vibecode-workspace/` | Lokale Suchordner (Remote-Suchordner stehen in `remote-hosts.json`) |
| `terminals.json` | `~/.config/vibecode-workspace/` | Presets pro Repository: Terminals und Browser-Tabs (Setup und Fenster schreiben dieselbe Datei) |
| `shortcuts/`, `home` | `~/.config/vibecode-workspace/` | Erzeugte Starter hinter den Schreibtisch-Aliassen; Pfad dieses Repos |
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
- **SSH: Remote-Mac nicht erreichbar:** auf dem Remote-Mac `workspace remote ssh info` ausführen
  (Entfernte Anmeldung an? Wachhalten an?) und prüfen, ob beide Macs im selben Netz sind
  oder Tailscale läuft

### Local Dev
- **Ollama nicht installiert:** [ollama.com](https://ollama.com)
- **Modell lädt nicht:** `ollama pull modellname` manuell ausführen
- **OpenCode nicht gefunden:** App in `/Applications` installieren

---

**Viel Erfolg mit deinem modularen VibeCode Workspace! 🚀**
