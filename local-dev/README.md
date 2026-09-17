# Local Dev – konfigurationsbasierter KI-Launcher

Ein Doppelklick auf `Local Dev.command` zeigt zuerst einen Baum der konfigurierten Hostings, lokal erkannten Modelle und installierten/kompatiblen CLIs. Danach waehlt man Repository, Hosting, Modell und CLI. Die drei aktiven Werte aus der Konfiguration sind Vorauswahlen:

```text
provider → model → framework
```

Im mitgelieferten Standardprofil bedeutet das:

```text
MLX → XHToken/Spark-X2.5-4B → OpenCode
```

Vor dem Start wird ein Repository aus der bereits eingerichteten VibeCode-Workspace-Liste gewählt. Die Startauswahl gilt nur fuer diese Sitzung; `local-ai.json` sowie globale CLI-Konfigurationen bleiben dabei unveraendert. Der naechste Doppelklick stoppt den tatsaechlich gestarteten Provider anhand der lokalen Sitzungsdatei.

Vor dem Start kann der Launcher speicherintensive Apps kontrolliert beenden. Im Standardprofil wird Google Chrome geschlossen und nur dann in einer Statusdatei vermerkt, wenn es zuvor wirklich lief. Beim nächsten Doppelklick (Toggle-Stopp) oder bei `--stop` wird Chrome mit seiner letzten Sitzung wieder geöffnet. Chrome stellt dadurch seine normalen Fenster und Tabs wieder her. Sobald ein Inkognito-Fenster offen ist, bleibt Chrome zum Schutz dieser nicht wiederherstellbaren Tabs vollständig geöffnet.

## Schnellstart

1. Im Finder auf `Local Dev.command` rechtsklicken, **Alias erzeugen** wählen und den Alias auf den Schreibtisch ziehen.
2. Den Alias doppelklicken.
3. Im Startdialog das Repository, Hosting, Modell und eine installierte kompatible CLI wählen. Bei nur einer Option wird automatisch gewählt.
4. Der Launcher startet den Provider, prüft den Health-Endpunkt und öffnet die CLI im Repository.

Beim ersten Start wird automatisch `local-dev/local-ai.json` aus der Vorlage erzeugt. Diese persönliche Datei wird nicht in Git gespeichert.

## Konfigurieren

Provider, Modell und Framework interaktiv auswählen:

```zsh
./Local\ Dev.command --setup
```

Alle Details können in `local-dev/local-ai.json` angepasst werden. Oben stehen die drei aktiven Werte gut sichtbar:

```json
{
  "provider": "mlx",
  "model": "XHToken/Spark-X2.5-4B",
  "framework": "opencode"
}
```

Die automatische Speicherfreigabe ist ebenfalls konfigurierbar:

```json
{
  "memory_management": {
    "enabled": true,
    "close_apps_on_start": ["Google Chrome"],
    "app_choices": ["Google Chrome", "Spotify", "Mail", "Notion"],
    "restore_apps_on_stop": true
  }
}
```

Mit `enabled: false` lässt sich das automatische Schließen vollständig ausschalten. Beim interaktiven `--setup` können die Einträge aus `app_choices` bequem mehrfach ausgewählt werden; die Auswahl wird in `close_apps_on_start` gespeichert. Weitere macOS-App-Namen können beiden Listen hinzugefügt werden. Wieder geöffnet werden ausschließlich Apps, die der Launcher selbst geschlossen hat. Für Chrome erzwingt der Launcher beim Öffnen die Wiederherstellung der letzten Sitzung; wichtige Seiten sollten trotzdem wie üblich als Lesezeichen gesichert sein.

Die Repository-Auswahl verwendet dieselbe Liste wie der Workspace-Starter:

```json
{
  "repository_selection": {
    "enabled": true,
    "projects_file": "~/.config/vibecode-workspace/projects.tsv",
    "remember_last": true
  }
}
```

Beim Start erscheint eine Einzelauswahl; das zuletzt verwendete Repository ist vorausgewählt. Mit `enabled: false` wird der Dialog übersprungen und wieder `working_directory` des gewählten Frameworks verwendet. Wenn die Workspace-Liste fehlt oder leer ist, nimmt der Launcher ebenfalls diesen Arbeitsordner als sichere Rückfalloption.

Das aktive Hardwareprofil wird ebenfalls nur über die JSON-Datei gewählt:

```json
{
  "hardware_profile": "m2-max-32gb",
  "hardware_profiles": {
    "m2-max-32gb": {
      "name": "Apple M2 Max · 32 GB",
      "chip": "Apple M2 Max",
      "unified_memory_gb": 32,
      "providers": {
        "mlx": {
          "memory_budget": {
            "additional_unified_memory_gb": 3,
            "usable_fraction": 0.75,
            "kv_bytes_per_element": 2
          },
          "server_args": ["--prompt-cache-size", "1"],
          "model_limits": {
            "context": 32768,
            "input": 32768,
            "output": 4096
          }
        }
      }
    }
  }
}
```

Damit sind die Hardwarewerte nicht im Launcher fest eingebaut. Für einen anderen Mac wird ein weiteres Objekt unter `hardware_profiles` angelegt und nur `hardware_profile` auf dessen Namen gesetzt. `--check` vergleicht den eingetragenen gemeinsamen Speicher auf macOS mit dem tatsächlich erkannten Wert. Providerspezifische `server_args` und `model_limits` im Hardwareprofil werden automatisch übernommen; direkte Werte im Provider bleiben als Fallback möglich. Fuer gecachte Hugging-Face-Modelle berechnet `--memory-plan` den KV-Cache pro Token aus der Modellarchitektur. Das zusaetzliche Kontextbudget wird auf 1024 Tokens abgerundet und durch `max_position_embeddings` begrenzt. Es ist eine Schaetzung, keine Garantie fuer stabilen Betrieb.

Mit `./Local\ Dev.command --tune-memory` kann man den bei typischer Last beobachteten zusaetzlichen RAM-Spielraum in GiB, eine unangetastete Reserve und den beobachteten Speicherdruck eingeben. Nur bei gruenem Speicherdruck wird `Spielraum - Reserve` ins persoenliche Hardwareprofil geschrieben; standardmaessig nutzt die Rechnung davon 75 %. Alternativ: `--tune-memory 4 1 gruen`. Die Prompt-Cache-Grenze wird dabei bewusst nicht zusaetzlich erhoeht, um denselben RAM-Spielraum nicht doppelt einzuplanen. Nach dem naechsten Start Speicherdruck und Stabilitaet erneut pruefen.

Die vollständige Vorlage liegt in `local-ai.example.json`; `local-ai.schema.json` beschreibt die gültigen Felder.

Ein Providerprofil enthält die technischen Details:

```json
{
  "type": "mlx",
  "protocol": "openai-chat",
  "provider_id": "mlx",
  "name": "MLX (lokal)",
  "default_model": "XHToken/Spark-X2.5-4B",
  "host": "127.0.0.1",
  "port": 8000,
  "server_command": "~/Spark-MLX-LLM/.venv/bin/spark-mlx-server",
  "server_args": [],
  "health_path": "/health"
}
```

Die aktive `model`-ID ist frei wählbar: Spark, Gemma, Qwen oder jedes andere vom gewählten Provider unterstützte Modell. `default_model` merkt sich beim Wechsel lediglich die letzte Auswahl des jeweiligen Providers. Der vorkonfigurierte `spark-mlx-server` registriert zusätzlich die Spark-Architektur und reicht anschließend an den normalen MLX-LM-Server weiter; er kann daher auch reguläre MLX-LM-Modelle laden. Beim Wechsel prüft der Launcher `/v1/models`, damit das Framework niemals versehentlich auf das zuvor geladene Modell zeigt.

Das mitgelieferte Hardwareprofil `m2-max-32gb` nutzt fuer Spark 3 GiB beobachteten Zusatzspielraum mit 75 % Sicherheitsfaktor. Aus 36 Layern, 4 KV-Heads und 256 Head-Dimension ergeben sich bei 16-Bit-KV-Cache 147.456 Byte pro Token: Das konfiguriert 49.152 statt 32.768 Kontext-Tokens. MLX haelt nur den letzten Prompt-Cache und behaelt die separate 5-GB-Cache-Grenze. Zwei parallele Decodes verhindern, dass die kurze OpenCode-Titelgenerierung den Auftrag blockiert. Spark laeuft mit `enable_thinking: false`.

Weitere MLX-, Ollama- oder kompatible API-Provider werden als zusätzliche Objekte unter `providers` eingetragen. Eigene Server können über ein `start_command`-Array ohne Shell-`eval` gestartet werden. In Argumenten sind `{provider}`, `{model}`, `{model_ref}` und `{base_url}` als Platzhalter verfügbar.

Frameworks liegen unabhängig davon unter `frameworks`. Dadurch kann derselbe Provider mit verschiedenen Clients kombiniert werden:

- `opencode`: bekommt eine temporäre `OPENCODE_CONFIG_CONTENT`-Konfiguration und `provider/model` übergeben.
- `codex`: nutzt Ollama über die eingebauten `--oss --local-provider ollama`-Parameter. Andere Provider müssen die Responses API anbieten.
- `claude`: nutzt `ANTHROPIC_BASE_URL` und benötigt deshalb einen Anthropic-kompatiblen Provider oder einen entsprechenden Gateway.
- `generic`: bekommt standardisierte `OPENAI_*`- und `LOCAL_AI_*`-Umgebungsvariablen; Argumente können die Platzhalter verwenden.

## Abos und bestehende Konfigurationen

Der Launcher verändert weder `~/.config/opencode`, `~/.codex/config.toml` noch Claude-Code-Einstellungen oder gespeicherte Logins. Alle Provider-Overrides gelten ausschließlich für den gestarteten Unterprozess.

Das bedeutet: Normal gestartetes Codex oder Claude Code verwendet weiterhin das jeweilige Abo und die normale Anmeldung. Nur ein über diesen Alias gestarteter Client wird auf den ausgewählten lokalen Provider geroutet.

Claude Code kann einen normalen OpenAI-kompatiblen MLX-/Ollama-Endpunkt nicht direkt verwenden. Dafür ist eine Anthropic-kompatible API beziehungsweise ein Gateway nötig. Codex benötigt bei benutzerdefinierten APIs die Responses API; Ollama wird nativ unterstützt. Der Launcher ändert deine Auswahl niemals heimlich, sondern meldet eine technisch inkompatible Kombination vor dem Start verständlich.

Der Startbaum markiert ein konfiguriertes, aber nicht lokal gefundenes Modell entsprechend. Bei MLX werden gecachte Hugging-Face-Modelle angezeigt, bei Ollama lokale Manifeste. Eine lokale Cache-Datei beweist noch nicht, dass alle Modellgewichte vollstaendig vorhanden sind; der Provider-Start und der Readiness-Check bleiben die verbindliche Pruefung. CLIs ohne installierten Befehl oder mit inkompatiblem API-Protokoll werden angezeigt, aber nicht zur Auswahl gestellt.

Konfigurationen aus der ersten Version mit `active_source`, `active_framework` und `sources` werden beim nächsten Aufruf automatisch migriert. Dabei bleibt eine wiederherstellbare Sicherung als `local-ai.json.pre-v2.bak` erhalten; auch die bisherigen Modellwerte aller Provider werden als `default_model` übernommen.

## Befehle

| Befehl | Funktion |
|---|---|
| `./Local\ Dev.command` | Toggle: starten und konfigurierte Apps schließen; erneut ausführen zum Stoppen und Wiederöffnen |
| `./Local\ Dev.command --setup` | Profile, Modell und automatisch geschlossene Apps auswählen |
| `./Local\ Dev.command --status` | Auswahl und API-Status anzeigen |
| `./Local\ Dev.command --capabilities` | Baum mit Hostings, Modellen und CLI-Status anzeigen |
| `./Local\ Dev.command --memory-plan` | KV-Cache und geplantes Kontextlimit anzeigen |
| `./Local\ Dev.command --tune-memory` | Beobachteten RAM-Spielraum mit Sicherheitsreserve eintragen |
| `./Local\ Dev.command --check` | Konfiguration, Programme und Kompatibilität prüfen |
| `./Local\ Dev.command --start-only` | Nur den aktiven Provider starten |
| `./Local\ Dev.command --stop` | Server stoppen und vom Launcher geschlossene Apps wieder öffnen |
| `./Local\ Dev.command --config-path` | Pfad der lokalen Konfiguration anzeigen |

Ein Server, der außerhalb des Launchers gestartet wurde, wird von `--stop` absichtlich nicht beendet.

## Anforderungen

- macOS mit Zsh, `curl` und `jq`
- Für das MLX-Spark-Beispiel: `~/Spark-MLX-LLM/.venv/bin/spark-mlx-server`
- Für Ollama: `ollama`
- Je nach Framework: `opencode`, `codex` oder `claude`

Prüfen:

```zsh
./Local\ Dev.command --check
```

Logs des Launchers und der von ihm gestarteten Server stehen in `local-dev/local-ai.log`.
