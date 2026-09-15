# Local Dev – konfigurationsbasierter KI-Launcher

Ein Doppelklick auf `Local Dev.command` liest genau drei aktive Werte aus der Konfiguration und führt sie der Reihe nach aus:

```text
provider → model → framework
```

Im mitgelieferten Standardprofil bedeutet das:

```text
MLX → XHToken/Spark-X2.5-4B → OpenCode
```

Der Provider wird gestartet, das konfigurierte Modell wird bereitgestellt und danach öffnet sich das konfigurierte Terminal-Framework im selben Fenster. Provider-Details, Endpoint, Startbefehl und Arbeitsordner liegen ebenfalls in der lokalen JSON-Konfiguration. Die Terminalansicht baut sich dynamisch aus diesen Werten und der verfügbaren Fensterbreite auf.

Vor dem Start kann der Launcher speicherintensive Apps kontrolliert beenden. Im Standardprofil wird Google Chrome geschlossen und nur dann in einer Statusdatei vermerkt, wenn es zuvor wirklich lief. Beim nächsten Doppelklick (Toggle-Stopp) oder bei `--stop` wird Chrome mit seiner letzten Sitzung wieder geöffnet. Chrome stellt dadurch seine normalen Fenster und Tabs wieder her. Sobald ein Inkognito-Fenster offen ist, bleibt Chrome zum Schutz dieser nicht wiederherstellbaren Tabs vollständig geöffnet.

## Schnellstart

1. Im Finder auf `Local Dev.command` rechtsklicken, **Alias erzeugen** wählen und den Alias auf den Schreibtisch ziehen.
2. Den Alias doppelklicken.
3. Der Launcher erkennt einen bereits laufenden Provider oder startet ihn, prüft den Health-Endpunkt und öffnet das konfigurierte Framework mit dem passenden Modell.

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
    "restore_apps_on_stop": true
  }
}
```

Mit `enabled: false` lässt sich das automatische Schließen vollständig ausschalten. Weitere macOS-App-Namen können in `close_apps_on_start` ergänzt oder Chrome daraus entfernt werden. Wieder geöffnet werden ausschließlich Apps, die der Launcher selbst geschlossen hat. Für Chrome erzwingt der Launcher beim Öffnen die Wiederherstellung der letzten Sitzung; wichtige Seiten sollten trotzdem wie üblich als Lesezeichen gesichert sein.

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
          "server_args": ["--prompt-cache-size", "1"],
          "model_limits": {
            "context": 24576,
            "input": 24576,
            "output": 4096
          }
        }
      }
    }
  }
}
```

Damit sind die Hardwarewerte nicht im Launcher fest eingebaut. Für einen anderen Mac wird ein weiteres Objekt unter `hardware_profiles` angelegt und nur `hardware_profile` auf dessen Namen gesetzt. `--check` vergleicht den eingetragenen gemeinsamen Speicher auf macOS mit dem tatsächlich erkannten Wert. Providerspezifische `server_args` und `model_limits` im Hardwareprofil werden automatisch übernommen; direkte Werte im Provider bleiben als Fallback möglich.

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

Das mitgelieferte Hardwareprofil `m2-max-32gb` ist für diesen Mac konservativ begrenzt: MLX hält nur den letzten Prompt-Cache, nutzt höchstens 4 GB Cache-Budget und verarbeitet nur einen großen Prompt gleichzeitig. Zwei parallele Decodes verhindern, dass die kurze OpenCode-Titelgenerierung den eigentlichen Auftrag blockiert. OpenCode kennt außerdem ein praktisches Kontextlimit von 24.576 Tokens und komprimiert mit 4.096 Tokens Reserve automatisch. Diese Werte liegen absichtlich unter dem theoretischen Modelllimit, weil Modellgewichte, KV-Cache, Metal-Zwischenspeicher und normale Apps denselben Arbeitsspeicher verwenden.

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

Konfigurationen aus der ersten Version mit `active_source`, `active_framework` und `sources` werden beim nächsten Aufruf automatisch migriert. Dabei bleibt eine wiederherstellbare Sicherung als `local-ai.json.pre-v2.bak` erhalten; auch die bisherigen Modellwerte aller Provider werden als `default_model` übernommen.

## Befehle

| Befehl | Funktion |
|---|---|
| `./Local\ Dev.command` | Toggle: starten und konfigurierte Apps schließen; erneut ausführen zum Stoppen und Wiederöffnen |
| `./Local\ Dev.command --setup` | Profile und Modell auswählen |
| `./Local\ Dev.command --status` | Auswahl und API-Status anzeigen |
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
