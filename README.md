# VibeCode Workspace - Modulares System

Ein **modulares macOS-System** für Entwickler, das **Workspaces, Remote-Management und lokale KI-Entwicklung** kombiniert.

Jedes Modul ist **unabhängig nutzbar** – du kannst genau die Features behalten, die du brauchst.

---

## 🚀 Quick-Launch-Buttons (für den Schreibtisch)

Im Hauptordner gibt es genau **eine** Datei zum Starten: `VibeCode Workspace.command` öffnet das Hauptfenster.
Dort verwaltest du Workspaces, Repository-Suche, Terminals und Browser-Tabs sowie SSH, Wachhalten und Local Dev.

> **Zwei Dateien heißen `VibeCode Workspace.command`:** Die im Hauptordner ist **die App** (das Fenster).
> Die in `workspaces/` ist der **Launcher** darunter (Projekte auswählen und in VS Code öffnen); du erreichst
> ihn über **Workspaces → Einmaliger Workspace…**, nie direkt.

Für einen Schreibtisch-Knopf zur App selbst: Rechtsklick auf `VibeCode Workspace.command` → **Alias erzeugen** → auf den
Schreibtisch ziehen (nie kopieren: der Starter findet seine Module über seinen eigenen Ort).
Für einzelne **Workspaces** und Suchordner legt die App den Schreibtisch-Alias selbst an (siehe unten).

---

## 🪟 VibeCode Workspace (Grundapp)

Ein Doppelklick auf `VibeCode Workspace.command` öffnet die Übersicht auf **Workspaces**.

| Reiter | Inhalt |
|--------|--------|
| **Workspaces** | Gespeicherte Workspaces starten und bearbeiten, Projekte spontan öffnen, Schreibtisch-Shortcuts, Agentenübersicht und Wachhalten & Apps. |
| **Projekte** | Lokale und entfernte Suchordner mit den gefundenen Repository-Zahlen sowie Terminal- und Browser-Presets. |
| **Remote** | Tailscale, Verbindungen von diesem Mac zu anderen Macs und Servern (mit der Einrichtung) und der Zugriff auf diesen Mac (Freigaben, Einladungen). |
| **Local Dev** | Anbieter, Modell und CLI als Vorauswahl festlegen, Ollama-Modelle verwalten (laden, entfernen), Kombinationen aus Modell und CLI speichern oder Local Dev öffnen. |

Der Punkt vor einer Zeile zeigt den Zustand: grün = eingerichtet und in Ordnung, orange = braucht Aufmerksamkeit
(z. B. keine Projekte gefunden), grau = aus oder nicht eingerichtet. **Öffnen** und **Verbinden** starten das Ziel im
Terminal und schließen die Übersicht. Jedes Modul meldet seinen Status selbst (siehe `module.json`).
Die eigenen macOS-Terminal-Fenster der App, ihrer Shortcuts und Module schließen nach erfolgreichem Abschluss automatisch,
auch nach einem Abbruch ohne Fehler. Bei Fehlern bleiben Ausgabe und Diagnose bis zur Bestätigung mit Enter sichtbar.
Laufende Agenten und SSH-Sitzungen bleiben geöffnet. Fenster mit mehreren Tabs und manuell benutzte Shells bleiben erhalten.
**Nur wachhalten** verhindert den automatischen Ruhezustand. **Wachhalten mit Apps** startet zusätzlich die unter **Apps wählen…**
ausgewählten Programme. **Claude Code** startet mit Remote Control im Terminal, **Codex** als Mac-App. Die Einstellung zum
Schließen von Apps beim Ausschalten gilt für den Modus mit Apps.

Ein **Workspace** ist eine benannte Auswahl von Projekten, z. B. „Demo“ = example-api + example-web + example-docs.
Es gibt zwei Wege, Projekte zu öffnen:

- **Workspace anlegen…** speichert so eine Auswahl **dauerhaft** unter einem Namen. Danach genügt **Starten** (oder ein
  Schreibtisch-Shortcut), und es öffnet immer genau diese Projekte, ohne Dialog.
- **Einmaliger Workspace…** wählt Projekte nur **für jetzt**: ein Dialog mit allen bekannten Repositories (die letzte Auswahl ist
  vorangekreuzt), **Öffnen** startet sie sofort. Gespeichert wird nichts außer „zuletzt gewählt“.

Mit dem Häkchen **Shortcut auf dem Schreibtisch** legt VibeCode alles Nötige selbst an:
einen kleinen Starter in `~/.config/vibecode-workspace/shortcuts/` und einen **Finder-Alias** mit dem
Namen des Workspaces auf dem Schreibtisch. Ein Doppelklick startet den Workspace direkt.

- Das Kästchen **Quick-Öffnen** in der Zeile eines Workspaces legt einen **zweiten** Shortcut an, benannt „<Workspace> öffnen“. Statt
  alles sofort zu starten, zeigt ein Doppelklick die Projekte des Workspaces zum Ankreuzen (nichts vorgewählt) und öffnet nur die
  angekreuzten. Abbrechen startet nichts, es wird nichts gespeichert, und Projekte, die der Launcher nicht mehr kennt, fehlen
  in der Liste. Der normale Shortcut bleibt unabhängig davon. Die Zeile zeigt „Quick ✓“. Gleiche Regeln wie oben: fremde Dateien
  werden nie überschrieben, Umbenennen, Ausschalten und Löschen räumen auf, **Shortcuts erneuern** legt ihn neu an.
  Im Terminal: `./VibeCode\ Workspace.command workspace-quick --name NAME on|off`.
- Im Dialog gibt es unten das Auswahlmenü **Local Dev** (nur sichtbar, wenn das Modul da ist und etwas startbar ist). Es listet jede
  startbare Kombination aus Anbieter, Modell und CLI, z. B. „Ollama (lokal) · qwen2.5-coder:7b → OpenCode“ („nicht lokal“: das Modell
  ist eingetragen, aber nicht heruntergeladen). Die Liste kommt aus dem Local-Dev-Modul selbst, es werden nur installierte, erreichbare
  und zueinander passende Paare angeboten. Ist eine gewählt, startet der Workspace **zusätzlich** ein Terminal **Local Dev** im
  **ersten lokalen Repository der Auswahl**, als letzter Split neben dessen Agent-Terminals. Es startet den lokalen Modellserver
  und darauf die CLI, ohne Rückfragen. Das gilt für **Starten**, den Schreibtisch-Shortcut und Quick-Öffnen (dort mit dem ersten
  angekreuzten Repository), nicht für SSH-Hosts. Local Dev macht dabei, was es immer macht, z. B. speicherintensive Apps wie Chrome
  schließen (einstellbar, siehe `local-dev/README.md`); gestoppt wird wie bisher über Local Dev (Toggle). Die Zeile zeigt „Local Dev ✓“.
  Ein gespeicherter Eintrag, den es nicht mehr gibt, bleibt im Menü als „(nicht verfügbar)“ stehen und wird nicht stillschweigend
  gelöscht. Im Terminal: `./VibeCode\ Workspace.command save … --local-dev-provider=P --local-dev-model=M --local-dev-framework=F`
  (oder `--no-local-dev`); ohne diese Angaben bleibt Local Dev beim Bearbeiten unverändert.
- Umbenennen, Häkchen entfernen oder Löschen aktualisiert den Alias mit.
- Eine fremde Datei mit demselben Namen auf dem Schreibtisch wird **nie** überschrieben oder gelöscht;
  stattdessen gibt es eine Fehlermeldung und nichts wird gespeichert.
- Verschiebst du das Repository, öffne die App einmal aus dem neuen Ordner: die Shortcuts finden es dann wieder.
- Beim ersten Shortcut kann macOS einmal nach dem Zugriff auf den Schreibtisch-Ordner fragen.
- **Ein Schreibtisch auf mehreren Macs** (iCloud „Schreibtisch & Dokumente“): Jeder Mac legt seinen **eigenen** Alias an. Der Name
  trägt den Namen des Macs, z. B. „Mein Workspace (Mac A)“ und „Mein Workspace (Mac B)“; so überschreiben sich die Macs nicht mehr
  gegenseitig. Jeder Mac fasst nur seine eigenen Aliasse an, die des anderen Macs bleiben stehen. Der Name kommt vom Computernamen
  (Systemeinstellungen → Allgemein → Info). Anders: Datei `~/.config/vibecode-workspace/mac-label` mit einem Wort (oder die
  Umgebungsvariable `VIBECODE_MAC_LABEL`); eine **leere** Datei schaltet den Zusatz ab. Aliasse ohne Zusatz aus älteren Versionen
  ersetzt **Shortcuts erneuern** durch die neuen, nur wenn sie von diesem Mac stammen oder tot sind. Ein Alias des anderen Macs ist
  auf diesem Mac meist tot oder zeigt auf dessen Starter; du kannst ihn ignorieren. Wird ein Mac umbenannt, bleibt sein alter Alias
  liegen und muss einmal von Hand gelöscht werden.
- Workspaces speichern Projekt-*Namen*, nicht Pfade. Fehlt ein Projekt, warnt das Fenster, und der Shortcut
  zeigt einen Alarm statt still nichts zu tun.
- Kennt der Launcher noch keine Projekte, unter **Repository-Suche → Ordner hinzufügen…** einen Repository-Ordner auswählen.

### Repository-Suche: Ordner hinzufügen, lokal oder remote

Statt jedes Repository einzeln einzutragen, gibst du **Ordner** an, in denen VibeCode sucht:

- **Ordner hinzufügen…** öffnet die Ordnerwahl (mehrere Ordner auf einmal sind möglich). VibeCode durchsucht den Ordner bis zu
  4 Ebenen tief und findet Repositories und Git-Worktrees. Versteckte Ordner, `node_modules`, `.venv`, `venv`, `.cache`,
  `Library` und verlinkte Ordner werden übersprungen; in einem gefundenen Repository wird nicht weiter gesucht. Ist ein Ordner
  riesig (Home-Verzeichnis, `/`), bricht die Suche ab und sagt es.
- **Remote-Ordner hinzufügen…** fragt nach **SSH-Host** (frei tippen: Alias aus `~/.ssh/config` oder `benutzer@host`, oder die Liste öffnen: dort stehen die schon verbundenen Geräte und die Macs, die im Tailnet gerade online sind) und **Ordner auf dem Server**
  (leer = Home). Auf dem Server wird rekursiv gesucht, wie beim Setup. Die Suche läuft ohne Passwortabfrage; klappt die Anmeldung
  noch nicht, bleibt der Host gespeichert, und das Fenster verweist auf **SSH → Neue Verbindung… → Geführte Einrichtung**.
- **Quick-Öffnen** ist ein Kästchen neben **Entfernen** und gilt pro lokalem Ordner (Standard: aus). Eingeschaltet legt es einen
  **Shortcut auf dem Schreibtisch** an, ein Finder-Alias wie bei den Workspaces, benannt nach dem Ordner (z. B. „GitHub öffnen“; die
  Zeile nennt den Namen). Ein Doppelklick darauf zeigt die Repositories genau dieses Ordners zum Ankreuzen, **Öffnen** startet die
  angekreuzten zusammen im Editor, ohne einen Workspace zu speichern. Abbrechen startet nichts. Es gelten die Terminals und
  Browser-Tabs aus den Presets. Ausgeschaltet verschwindet der Shortcut wieder. Liegt auf dem Schreibtisch schon eine fremde Datei
  gleichen Namens, wird sie nie überschrieben: das Fenster nennt den Grund und das Kästchen bleibt aus. **Shortcuts erneuern** legt
  auch diese Shortcuts neu an, und **Entfernen** des Suchordners nimmt seinen Shortcut mit. Fehlende Ordner und Remote-Ordner haben
  das Kästchen nicht. Im Terminal: `./VibeCode\ Workspace.command folders quick-open --path=ORDNER --mode=on|off`.
- **Entfernen** beendet nur die Suche. Repositories, Platte und Server bleiben unberührt; Workspaces mit Projekten daraus zeigen
  danach ⚠︎.

Der Launcher durchsucht die Ordner bei jedem Start und zeigt die Funde in der Projektauswahl; die Übersicht selbst fragt **keinen
Host per SSH** an, sie zeigt den zuletzt gefundenen Stand. Lokale Ordner stehen in `~/.config/vibecode-workspace/search-folders.json`,
Remote-Hosts in `remote-hosts.json`. Auch im Terminal: `./VibeCode\ Workspace.command folders list | add PFAD | remove PFAD | add-remote HOST [ORDNER] | remove-remote HOST`.

### Presets: pro Repository eine Konfiguration

Ein **Preset** legt fest, welche **Terminals** (Shell, Claude Code, Codex, Codex 2, Antigravity oder ein eigener Befehl, je mit
Name und Unterordner) und welche **Browser-Tabs** für ein Repository starten. Es ist dieselbe Konfiguration wie bei „Terminals ändern“
im Setup (`terminals.json`), nur im Fenster:

- **Local-Dev-Terminals:** Die Auswahl „Terminal“ bietet nach den festen Typen deine gespeicherten **Kombinationen** an
  („Local Dev · qwen2.5-coder:7b → OpenCode · Ollama“, siehe **Local Dev → Kombinationen**). Das Terminal startet den lokalen
  Modellserver und darauf die CLI im Repository, ohne Rückfragen, wie das Local-Dev-Terminal eines Workspaces. Es läuft nur auf diesem
  Mac: auf einem SSH-Host zeigt das Terminal stattdessen den Grund. Im Preset steht Anbieter, Modell und CLI selbst (nicht ein Verweis
  auf die Kombination): löschst du die Kombination, bleibt das Terminal erhalten und erscheint als „(nicht gespeichert)“. Hat der
  Workspace dieselbe Kombination für dasselbe Repository ohnehin, startet sie nicht doppelt. Zwei **verschiedene** MLX-Modelle in einem
  Workspace stören sich, denn es läuft nur ein MLX-Server (bei Ollama nicht).
- **Öffnen in** legt pro Terminal **Unteres Panel**, **Editor-Tab** oder **Editor-Raster** fest. **Standard** übernimmt die
  Einstellung aus VS Code. Die Auswahl wird im Preset gespeichert und gilt beim nächsten Workspace-Start.
- **Allgemeiner Standard:** die erste Zeile des Bereichs. Er gilt für **jedes Repository ohne eigenes Preset**, lokal wie auf
  SSH-Hosts. Solange du nichts festlegst, sind das die eingebauten **Standard-Terminals** (Frontend, Storybook, Claude, Codex 1,
  Codex 2, ohne Browser-Tabs). **Festlegen…** öffnet dasselbe Formular, **Zurücksetzen** bringt die eingebauten zurück. Hat ein
  Repository eigene Einstellungen (auch „keine Terminals“), gewinnen die. Ein Unterordner, den ein Repository nicht hat, wird dort
  übersprungen: das Terminal startet im Repository-Ordner. Auf SSH-Hosts läuft `bash` statt `zsh`.
- **Preset anlegen…** wählt ein Repository und öffnet das Formular. Ohne Preset startet es mit dem **allgemeinen Standard**,
  also mit dem, was dort heute wirklich läuft. Typ „–“ lässt eine Zeile aus.
- **Bearbeiten…** ändert ein vorhandenes Preset, **Zurücksetzen** bringt den allgemeinen Standard zurück.
- Der Startbefehl wird vom Setup-Assistenten selbst gebaut (inklusive sicherem Quoting des Prompts); das Fenster schreibt
  Typ, Name, Prompt, Unterordner und Öffnungsort. Ein ungültiges Preset (z. B. Unterordner mit `..`, Browser-Tab ohne `http://`) wird mit
  Grund abgelehnt, deine Eingaben bleiben stehen. Eine beschädigte `terminals.json` wird nie ersetzt.
- **Presets hängen am Pfad des Repositories.** Verschiebst du ein Repository, gilt sein Preset nicht mehr. Die Übersicht zeigt es
  dann orange als „Repository nicht mehr gefunden“; gibt es genau ein gleichnamiges Repository am neuen Ort, überträgt
  **Übernehmen** das Preset dorthin. Das alte wird erst nach dem erfolgreichen Kopieren entfernt.
- Im Terminal: `./VibeCode\ Workspace.command presets list | save --path=PFAD --data=JSON | reset PFAD | move ALT NEU | save-general --data=JSON | reset-general`.

### Terminal-Layout im Editor

Öffne in VS Code mit `⌘⇧P` den Befehl **VibeCode: Terminal-Layout wählen**.

- **Splits im Terminalpanel** öffnet die Projektterminals wie gewohnt unten. Das ist der Standard.
- **Terminal-Tabs pro Projekt** gibt jedem Projekt eine eigene Tableiste. Die Editorzeilen stehen untereinander.
- **Terminal-Raster pro Projekt** zeigt alle Terminals eines Projekts nebeneinander und die Projekte untereinander.

Die Wahl gilt als Standard. Mit **VibeCode: Öffnungsort für Terminals wählen** kannst du Terminals ohne festen Öffnungsort
im Preset auswählen und ihnen Panel, Tabs oder Raster zuweisen. Tabs desselben Projekts teilen sich
eine Editorgruppe. Raster-Terminals bekommen je eine eigene Gruppe daneben. **Standard-Layout verwenden** hebt die
individuelle Zuordnung auf.

Lege beispielsweise Dev-Server ins Panel und Agenten ins Raster. Mit `⌘J` blendest du das untere Panel ein und aus.
Die Agenten aller Projekte im selben Workspace bleiben dabei sichtbar. VS Code speichert die Wahl lokal. Sie greift
beim nächsten Start der Projektterminals. Sind alle Projektterminals geschlossen, startet die Auswahl sie direkt neu.

### SSH im Fenster

Der Reiter **Remote** ist nach Richtung geordnet: **Tailscale** (das Netz), **Verbindungen von diesem Mac** (hierhin kommst du) und
**Zugriff auf diesen Mac** (wer hierhin kommt). Unter *Verbindungen von diesem Mac* öffnest du eine Verbindung zu einem eingerichteten
Mac oder Server; **Geführte Einrichtung…** richtet einen SSH-Host und seinen Suchordner ein. Unter **Projekte → Remote-Suchordner**
siehst du den Pfad und die zuletzt gefundenen Repositories desselben Hosts. Die Übersicht liest den gespeicherten Stand.

Ein **Punkt** steht nur für einen Zustand, der gerade stimmt: grün = läuft/online, grau = aus/offline, orange = braucht dich. Einstellungen
(das Kästchen *Mit VibeCode starten und beenden*), Freigaben und Knöpfe haben keinen Punkt. Bei Verbindungen kommt „online“ oder
„offline“ aus Tailscale (Name, Tailscale-Name oder Adresse passt zu einem Gerät); die Übersicht kontaktiert keinen SSH-Host. Ziele, die
nicht im Tailnet stehen, haben keinen Punkt, und erreichbare Ziele stehen oben.

| Schaltfläche | Was sie tut |
|--------------|-------------|
| **Verbinden** | öffnet die gewählte Verbindung als SSH-Sitzung im Terminal |
| **Neue Verbindung…** | **ein** Dialog: die Zeile des anderen Macs einfügen und **Verbinden** (ohne Passwort), oder **Geführte Einrichtung…** (Host, Schlüssel, Repository-Suche, im Terminal). Liegt eine passende `join`-Zeile in der Zwischenablage (z. B. per Universal Clipboard vom Remote-Mac), steht sie schon im Feld. Beim Prüfen erscheint sofort eine Mitteilung („Verbinde …“), danach das Ergebnis |
| **Diesen Mac freigeben…** | kurze Maske: Ist „Entfernte Anmeldung“ aus, öffnet sie die Systemeinstellungen und sagt nur das Eine, was fehlt (**Erneut prüfen** fragt nach, ohne sie wieder zu öffnen). Ist sie an, zeigt sie den Status (Wachhalten an/aus), die Zeile für den anderen Mac in einem markierbaren Feld (sie liegt auch in der Zwischenablage) und die zwei Schritte. **Zeile kopieren** legt die Zeile (noch einmal) in die Zwischenablage. **Schlüssel eintragen…** trägt den Schlüssel des anderen Macs ein, nachdem du den Fingerprint bestätigt hast; eine passende `allow`-Zeile aus der Zwischenablage ist schon eingetragen. Terminal-Befehle zeigt die Maske nicht |

Zwischen zwei Macs, jeweils mit dieser App: auf dem **Remote-Mac** *Diesen Mac freigeben…* → Zeile kopieren; auf dem **Client-Mac**
*Neue Verbindung… → Mit der Zeile…* → einfügen → die angezeigte Zeile kopieren; zurück auf dem **Remote-Mac** *Schlüssel eintragen…* →
einfügen, Fingerprint prüfen, bestätigen; auf dem **Client-Mac** *Verbinden*. *Wach halten* in der SSH-Freigabe
verhindert den automatischen Ruhezustand. Das hilft, den Mac auch bei längerer Inaktivität erreichbar zu halten.

**Unterwegs (Tailscale):** `.local`-Namen und die Heimnetz-Adressen (192.168.…) gibt es nur im selben Netz. Von außerhalb braucht es
[Tailscale](https://tailscale.com) auf **beiden** Macs (gleiches Konto). Tailscale legt nur eine private Verbindung zwischen deinen
eigenen Geräten an. Das normale Internet läuft weiter über die eigene Leitung jedes Macs (außer du schaltest ausdrücklich einen
„Exit Node“ ein). Die Agenten laufen auf dem Remote-Mac und nutzen dessen Internetanschluss, sie verlieren also nichts. Der
Remote-Mac muss dafür wach sein (Wach halten).

- **Die Zeile kommt von selbst richtig heraus.** Läuft Tailscale auf dem Remote-Mac, steht in der `join`-Zeile von *Diesen Mac
  freigeben…* der Tailscale-Host statt `<Mac>.local`, und die Zeile gilt dann auch zu Hause und unterwegs. Ist MagicDNS im Tailnet an,
  ist das der Name (`mac.dein-tailnet.ts.net`), sonst die 100.x-Adresse, die immer auflöst. Läuft Tailscale nicht, bleibt es bei
  `.local`. Die Maske sagt, wie weit die Zeile reicht („gilt auch unterwegs“ oder „nur im selben Netz“); im Terminal zeigt
  `workspace remote ssh share` zusätzlich die `.local`-Zeile fürs Heimnetz.
- **Dieselbe Verbindung, nur ein anderer Name.** Es bleibt das normale SSH mit Fingerprint-Prüfung (`join` / `allow`), kein
  `tailscale ssh`. Auf dem Client-Mac läuft die Tailscale-App ebenfalls, sonst ist der Tailscale-Host nicht erreichbar.
- **Klare Fehlermeldungen.** Ist ein Tailscale-Ziel nicht erreichbar, nennt die Meldung den Grund: Tailscale fehlt oder ist nicht
  verbunden/angemeldet, der Remote-Mac ist im Tailnet offline (vermutlich im Ruhezustand: *Wach halten*), das Gerät ist im Tailnet
  unbekannt, der Tailscale-Name löst auf diesem Mac nicht auf (dann steht die 100.x-Adresse in der Meldung) oder Tailscale steht, aber „Entfernte
  Anmeldung“ antwortet nicht. Ein Host ohne Punkt, den Tailscale nicht kennt (z. B. ein SSH-Alias), bekommt keine Tailscale-Aussage.
- **Projekte des anderen Macs.** Beim **Remote-Ordner hinzufügen…** ist der Host des verbundenen Macs schon eingetragen (derselbe
  Text wie im SSH-Ziel, nur bei Port 22). Remote-Projekte heißen `<Ordner> [SSH: <Host>]`: **wechselst du den Host** (z. B. von
  `.local` auf den Tailscale-Namen), heißen sie anders, und gespeicherte Workspaces zeigen „⚠︎ nicht gefunden“. Dann den Workspace
  einmal neu auswählen.
- **Eigene Angaben.** Die Tailscale-Programmdatei wird in `PATH`, in `/Applications/Tailscale.app` und in den Homebrew-Ordnern gesucht;
  mit `VIBECODE_TAILSCALE=/Pfad/zu/tailscale` lässt sie sich festlegen (leer = Tailscale ignorieren).

### Tailscale im Fenster

Unter **Remote → Tailscale** steuerst du die Verbindung. Es genügt die **Kommandozeilen-Variante**
(`brew install tailscale`: nur die Programme `tailscale` und `tailscaled`). Die App von tailscale.com geht ebenso; VibeCode erkennt, was da ist.

- **Einrichten…** (nur Kommandozeile): öffnet ein Terminal, das Tailscale per Homebrew installiert, den Systemdienst startet
  (`sudo brew services start tailscale`) und diesem Konto die Steuerung erlaubt (`sudo tailscale set --operator="$USER"`). Du gibst dein
  Admin-Passwort **dort** ein; VibeCode sieht es nie und führt selbst nie `sudo` aus. Der Dienst läuft als root, deshalb ist dieser
  einmalige Schritt nötig; ohne ihn lehnt Tailscale `up` und `down` für normale Konten ab (das Fenster sagt dann „Zugriff verweigert“).
  Ist die Tailscale-App installiert, bricht das Terminal ab: zwei Tailscale-Dienste auf einem Mac stören sich.
  Tailscale selbst empfiehlt eher die App; die Kommandozeilen-Variante ist weniger getestet und nicht in den macOS-VPN-Einstellungen sichtbar.
- **Anmelden…**: holt den Anmelde-Link von Tailscale und öffnet ihn im Browser (nur `https://`). Nach der Anmeldung dort auf **Aktualisieren**
  klicken. **Abmelden…** fragt vorher nach, weil dieser Mac dann nicht mehr erreichbar ist.
- **Verbinden** / **Trennen** sind ein einfaches `tailscale up` / `tailscale down` (ohne Optionen, damit deine Einstellungen bleiben).
- **Geräte…** listet die anderen Geräte deines Tailnets: Name, 100.x-Adresse, System, online oder zuletzt gesehen.
- **Gerät aus Tailscale freigeben…** (im Dialog **Diesen Mac freigeben…**, nur wenn „Entfernte Anmeldung“ an ist und ein eigenes Gerät online
  ist): so läuft es **vom freigebenden Mac aus**. Dort wählst du das Gerät, das Zugriff bekommen soll. VibeCode schickt ihm per Taildrop eine
  Einladung (Host, Benutzer, den Host-Schlüssel dieses Macs, einen Einmal-Code; sie gilt eine Stunde). Auf dem anderen Mac wählst du im Bereich
  **Remote** **Einladungen abholen** und **Annehmen**: VibeCode prüft, dass der Host-Schlüssel zur Einladung passt, merkt ihn, speichert das Ziel
  und schickt den **öffentlichen** Schlüssel dieses Macs zurück. Zurück auf dem freigebenden Mac: **Einladungen abholen**, dann siehst du Name
  und Fingerprint und bestätigst. Erst dann wird der Schlüssel eingetragen (Taildrop prüft den Absender einer Datei nicht, deshalb bleibt diese
  eine Bestätigung). Kein Passwort, keine Zeilen zum Kopieren. Ein Code gilt genau einmal.
  - **Taildrop-Posteingang:** `tailscale file get` holt immer **alles** aus dem Posteingang. VibeCode liest deshalb nur Dateien mit genau
    den Namen `vibecode-invite-…json` / `vibecode-answer-…json` (höchstens 16 KB, strenges Format), alles andere legt es unverändert nach
    `~/Downloads` (bei gleichem Namen mit Nummer) und sagt, wie viele Dateien das waren. Es löscht nie etwas, das nicht von ihm stammt.
  - **Voraussetzungen:** Tailscale auf beiden Macs und beide online. Verifiziert ist die Kommandozeilen-Variante (Einrichten…); bei der
    Tailscale-App muss Taildrop in den Systemeinstellungen an sein und der Empfang ist **nicht** geprüft. Dann nimm den Weg unten, der immer geht.
- **Gerät per SSH verbinden…** (nur wenn Tailscale läuft und andere Geräte da sind): der Weg **vom Client aus**, ein Passwort einmal.
  Der kürzeste Weg zu einem zweiten Mac, wenn Taildrop nicht geht. Du wählst das
  Gerät aus deinem Tailnet und gibst den Benutzernamen dort an, mehr nicht. Es gibt keine Zeilen, die zwischen den Macs wandern. Tailscale
  bestätigt, dass es **dein eigenes** Gerät ist (gleiches Konto, nicht von außen hereingeteilt); darauf vertraut VibeCode seinem
  Host-Schlüssel beim ersten Mal und trägt ihn für Name **und** 100.x-Adresse in `known_hosts` ein (nie über einen schon vorhandenen
  Eintrag). Fehlt dein Schlüssel dort noch, öffnet sich ein Terminal, das ihn mit `ssh-copy-id` einmal mit dem **Passwort des Benutzers
  dort** einträgt und das Ergebnis anzeigt; danach „Gerät per SSH verbinden…“ noch einmal wählen. Hat dieser Mac noch keinen SSH-Schlüssel,
  erzeugt dasselbe Terminal zuerst einen (die Passphrase wählst du selbst); hat er eine Passphrase und ist nicht im ssh-agent, fragt es sie einmal ab
  und merkt sie im Schlüsselbund. Löst der Tailscale-Name auf diesem Mac nicht auf (Tailscale-DNS aus), speichert VibeCode die 100.x-Adresse. Voraussetzung: „Entfernte Anmeldung“
  ist auf dem anderen Mac an. Den Weg über die Zeile (**Neue Verbindung…**) und die geführte Einrichtung für beliebige Server gibt es
  unverändert. Tailscales eigenes SSH (`tailscale ssh`) nutzt VibeCode bewusst nicht: die Standardregel „check“ verlangt regelmäßig eine
  neue Anmeldung im Browser, das bricht Agenten und den Editor ab.
- **Mit VibeCode starten und beenden** (Kästchen **Aktiv**): Startest du einen Workspace (Schreibtisch-Shortcut, **Starten**, Quick-Öffnen,
  **Einmaliger Workspace…**), verbindet VibeCode Tailscale vorher, falls es getrennt ist. Bei Remote-Projekten (`[SSH: …]`) wartet der
  Start bis zu 10 Sekunden darauf, damit Remote-SSH sofort eine Verbindung findet. **Beendet** wird so: Sobald das **letzte von VibeCode
  geöffnete Editor-Fenster** geschlossen ist, trennt ein kleiner Hintergrundprozess Tailscale nach etwa einer Minute. Dafür meldet sich jedes
  solche Fenster alle 15 Sekunden bei VibeCode (die mitgelieferte Erweiterung ab Version 0.0.7; die Fenster anderer Projekte zählen nicht).
  Schläft der Mac mit offenem Fenster, bekommt es nach dem Aufwachen eine volle Schonfrist, sich wieder zu melden; geschlossen wird also nie
  beim Aufklappen des Deckels. Sicherheitsregeln: VibeCode trennt **nur**, was VibeCode selbst verbunden hat (lief Tailscale schon, bleibt es an), nie nach einer
  Handentscheidung (**Verbinden** und **Trennen** löschen die Marke „von VibeCode gestartet“), und **im Zweifel bleibt Tailscale an**: meldet in zehn Minuten kein Fenster
  (alte Erweiterung, abgebrochener Dialog), wird nichts getrennt. Das bloße Öffnen der Übersicht startet Tailscale nicht, denn dabei gibt es kein
  Editor-Fenster, das es wieder beenden könnte.
- Nach einem Update der Erweiterung läuft sie in einem schon geöffneten VS Code erst nach einem vollständigen Beenden (⌘Q) und neuem Start.
- Im Terminal: `./VibeCode\ Workspace.command tailscale up|down|login|logout|auto-on|auto-off|setup`.

Meldet `join` „nicht erreichbar … nodename nor servname“, wird der Name nicht gefunden (anderes Netz, kein Tailscale): dann den
Tailscale-Host oder die IP-Adresse des Remote-Macs nehmen (`ipconfig getifaddr en0`, bei WLAN `en1`).

### Agenten-Überblick

Der Bereich **Agenten** zeigt in einer Zeile, was Claude Code und Codex gerade tun, zum Beispiel „1 arbeitet · 2 warten auf dich“.
**Agenten…** öffnet die Liste mit Zustand, Projekt, Agent, Branch und Alter.

- **Woher das kommt:** aus den Verlaufsdateien der Agenten (`~/.claude/projects`, `~/.codex/sessions`, plus `$CODEX_HOME` und
  `$CLAUDE_CONFIG_DIR`; mit `VIBECODE_CLAUDE_PROJECTS` / `VIBECODE_CODEX_SESSIONS` ersetzbar). Gelesen wird nur das Ende jeder Datei
  der letzten 3 Stunden, ausgegeben werden nur Agent, Ordner, Branch, Zustand und Alter, **nie Nachrichtentext**. An deinen Agenten ändert
  sich nichts (keine Hooks, keine Einstellungen).
- **Zustände (geschätzt):** ● arbeitet · ○ fertig, wartet auf dich · ◐ ein Befehl läuft oder wartet auf Freigabe · ◌ unklar, seit
  längerem still. Es ist ein Schnappschuss, kein Live-Monitor: **Aktualisieren** liest neu.
- **Nur deine Projekte:** angezeigt werden Sitzungen, deren Ordner in einem bekannten Projekt liegt (der längste passende Pfad gewinnt).
  Scratch-Ordner und Sitzungen der Desktop-Apps bleiben draußen.
- **Der andere Mac:** **Auf <Mac> prüfen** startet per SSH (ohne Passwortabfrage, mit Zeitlimit) dasselbe Skript dort und zeigt die Sitzungen
  des Remote-Macs, also die Agenten, die du von hier aus gestartet hast. Das passiert **nur auf diesen Klick**; die Übersicht fragt nie
  einen anderen Mac. Dort muss `python3` vorhanden sein (auf einem Mac: die Command Line Tools), sonst sagt die Meldung es.
- Im Terminal: `./VibeCode\ Workspace.command agents local|remote` (JSON).

Auch ohne Fenster:

```bash
./VibeCode\ Workspace.command list                     # gespeicherte Workspaces
./VibeCode\ Workspace.command run Demo                 # Workspace starten
./VibeCode\ Workspace.command save --name=Demo --project=example-api --project=example-web --shortcut
./VibeCode\ Workspace.command delete --name=Demo       # samt Schreibtisch-Shortcut
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
**Zweck:** Einen entfernten Mac wach halten, Claude/Codex darauf laufen
lassen und sich von einem anderen Mac per SSH verbinden.

| Feature | Beschreibung |
|---------|-------------|
| **Wachhalten** | Hält den Mac per `caffeinate` wach, bis der Timer abläuft oder du den Modus ausschaltest |
| **Plattformen / Apps** | Startet die gewählten Apps beim Einschalten. Du stellst ein, ob sie beim Ausschalten geschlossen werden |
| **Kontrollterminal** | Menü zum manuellen Ein-/Ausschalten, zur App-Auswahl und für Timer |
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

Beim Start über **Workspaces → Einmaliger Workspace…** (oder `./VibeCode\ Workspace.command launch`) die gewünschten Projekte anhaken und
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

1. `./VibeCode\ Workspace.command setup` aufrufen und **„Remote-Repository hinzufügen“** wählen. Für die automatische Suche ganzer Ordner gibt es in der App **Repository-Suche → Remote-Ordner hinzufügen…**.
2. Den **SSH-Hostalias** (z. B. `spark` aus `~/.ssh/config`, alternativ `user@host`) und den **absoluten Repository-Pfad auf dem Server** eingeben. Port, Schlüssel und ProxyJump werden über die SSH-Konfiguration festgelegt.
3. Im anschließenden Terminal-Setup das neue Projekt auswählen und Codex, Claude Code, Shells oder eigene Befehle konfigurieren. Unterordner wie `frontend` beziehen sich auf den Server; bei einem Projekt ohne diesen Unterordner das Arbeitsverzeichnis leer lassen.
4. Die App starten (**Workspaces → Einmaliger Workspace…**) und das Remote-Projekt anhaken. Der Launcher installiert bei Bedarf **Remote - SSH** in VS Code; VS Code übernimmt Verbindung und Anmeldung. Beim ersten Start den Workspace als vertrauenswürdig bestätigen, damit Agent-Terminals starten.

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
# Kontrollterminal integriert in VS Code starten
OPEN_CONTROL_TERMINAL=true
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
| `remote.example.json` | Standardwerte für Wachhalten und Apps. Deine Einstellungen liegen in `~/.config/vibecode-workspace/remote/config.json` |

**Usage** (`workspace` steht hier für `./workspaces/workspace`):
```bash
workspace remote on        # Wachhalten + gewählte Apps starten
workspace remote off       # Wachhalten lösen, Apps je nach Einstellung beenden
workspace remote status    # aktuellen Zustand zeigen
workspace remote control   # Kontrollterminal (Menü)
```

Im Kontrollterminal schaltet **1** den Modus dauerhaft ein oder aus. Unter **2** wählst du die Apps,
die bei AN laufen sollen. Mit **3** legst du fest, ob sie bei AUS geschlossen werden.
Mit **4** schaltest du für eine Dauer ein, mit **5** schaltest du für eine Dauer aus und danach einmal wieder ein.
Unter **7** stellst du den automatischen Wechsel ein. Gib die AN-Dauer und die AUS-Dauer an. Enter bei der
AUS-Dauer übernimmt die AN-Dauer. Der Wechsel beginnt mit dem aktuellen Zustand und wiederholt sich.
Eine Zahl wie `3` steht für Stunden. Du kannst auch `90m` oder `2h` eingeben. Der Timer läuft bei geschlossenem
Kontrollterminal weiter. **6** hebt den Timer oder den automatischen Wechsel auf und behält den aktuellen Zustand bei.
Nach dem Ruhezustand setzt VibeCode den Zeitplan entsprechend der Uhrzeit fort. Wechsel, die in den Ruhezustand
fallen, werden übersprungen.

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
installierst du [Tailscale](https://tailscale.com) auf beiden Macs. `workspace remote ssh share` gibt dann die Zeile mit dem
Tailscale-Host aus (Name oder 100.x-Adresse); von Hand: `workspace remote ssh set benutzer@<Tailscale-Host>`.

---

### Local Dev (`local-dev/`)
| Datei | Zweck |
|-------|-------|
| `local-ai.json` | Persönliche Auswahl von Provider, Modell und Framework |
| `local-ai.example.json` | Versionierte Vorlage mit MLX-, Ollama- und Frameworkprofilen |

**Usage:**
- **VibeCode-App → Local Dev → Öffnen** zeigt den Verfügbarkeitsbaum und die Auswahl für Repository, Hosting, Modell und kompatible CLI.
- **Ollama-Modelle:** Der Reiter **Local Dev** listet die geladenen Modelle mit Größe (aus den Manifesten unter `~/.ollama/models`,
  ohne Ollama aufzurufen) und darunter, was **noch nicht geladen** ist: das in Local Dev eingestellte Modell und eine kurze
  Vorschlagsliste (`local-dev/ollama-suggestions.json`). Eine Bibliotheks-Abfrage gibt es nicht; jedes andere Modell lädst du mit
  **Modell laden…** über seinen Namen. **Laden…** fragt zuerst und öffnet ein Terminal mit `ollama pull` (Modelle sind oft mehrere GB
  groß, der Fortschritt gehört dorthin). **Entfernen…** fragt zuerst und führt `ollama rm` aus. Beides braucht gefundenes Ollama, und
  der Ollama-Dienst muss laufen. Nach dem Laden **Aktualisieren** klicken.
- **Kombinationen:** **Kombination anlegen…** speichert ein Paar aus Modell und CLI (aus derselben Liste wie **Einstellen…**, also nur
  zueinander passende) in `~/.config/vibecode-workspace/local-combos.json`. Ein noch nicht geladenes Ollama-Modell zeigt die Zeile
  vorher in Orange; es würde beim ersten Start geladen. Der Preset-Editor unter **Projekte** bietet die Kombinationen als Terminal an.
- Unter **VibeCode-App → Local Dev → Einstellen…** kannst du Anbieter (MLX oder Ollama), Modell und CLI (OpenCode, Codex, Claude)
  in einem Auswahlmenü festlegen. Das ist die Vorauswahl beim Start von Local Dev (sie landet in `local-ai.json`, die Statuszeile zeigt
  sie sofort). Das Menü listet **alle** konfigurierten, zueinander passenden Kombinationen, auch nicht installierte (Hinweis „Anbieter
  fehlt“ oder „CLI fehlt“), damit man MLX oder OpenCode einstellen kann, bevor sie da sind. Ein unpassendes Paar (z. B. Codex mit MLX)
  gibt es dort nicht, und das Modul lehnt es auch beim Speichern ab. Für einen einzelnen Workspace wählst du Local Dev stattdessen im
  Dialog des Workspaces (dort nur, was sich jetzt starten lässt). Im Terminal: `./VibeCode\ Workspace.command local --set-default ANBIETER MODELL CLI`.
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
| `search-folders.json` | `~/.config/vibecode-workspace/` | Lokale Suchordner, je mit optionalem `quickOpen` für den Schreibtisch-Shortcut (Remote-Suchordner stehen in `remote-hosts.json`) |
| `terminals.json` | `~/.config/vibecode-workspace/` | Presets pro Repository (`projects`) und der allgemeine Standard (`default`): Terminals und Browser-Tabs (Setup und Fenster schreiben dieselbe Datei) |
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

## Datenschutz bei Beiträgen

Dieses Repository ist öffentlich. Die verbindlichen Regeln stehen in [AGENTS.md](AGENTS.md)
und [CLAUDE.md](CLAUDE.md); für Cursor gilt zusätzlich eine [immer aktive Projektregel](.cursor/rules/public-repository-privacy.mdc).
Sie gelten für Code, Tests, Beispiele, Dokumentation sowie Commit-Nachrichten und Autorendaten.

Verwende ausschließlich erfundene Namen, Geräte, Pfade und Projekte, etwa `user@remote-mac.local`,
`/Users/example/` und `example-api`. Echte Verbindungsdaten, öffentliche oder private SSH-Schlüssel,
Fingerprints, Zugangsdaten, Logs und persönliche Konfigurationen gehören nicht in versionierte Dateien.
Testschlüssel dürfen nur für den Test in temporären Verzeichnissen erzeugt werden.

Richte in jedem neuen Klon die neutrale Git-Identität ausschließlich für dieses Repository ein:

```bash
git config --local user.name "VibeCode Contributors"
git config --local user.email "contributors@example.invalid"
```

Prüfe vor jedem Commit den vollständigen gestagten Diff einschließlich neuer Dateien auf persönliche
Angaben und führe einen Secret-Scan mit geschwärzter Ausgabe aus, zum Beispiel mit installiertem Gitleaks:
`gitleaks git --pre-commit --staged --redact=100`. Prüfe vor dem Push alle ausgehenden Commits samt Metadaten.
`.gitignore` schützt keine bereits versionierten Dateien oder persönlichen Angaben innerhalb von Quelltext;
auch ein Secret-Scanner ersetzt die manuelle Datenschutzprüfung nicht.

Nach einer Bereinigung der Historie alte Klone neu klonen und nur geprüfte Änderungen übertragen,
damit entfernte Informationen nicht durch einen Merge oder Push wieder veröffentlicht werden.

---

**Viel Erfolg mit deinem modularen VibeCode Workspace! 🚀**
