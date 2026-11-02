// Run on macOS: node --test tests/presets.test.js
// Real presets.js against the real terminal-setup.js; temp config only, never ~/.config.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workspaces = path.join(root, 'workspaces');
const wizardSource = fs.readFileSync(path.join(workspaces, 'terminal-setup.js'), 'utf8');

function fixture(t) {
    const dir = fs.mkdtempSync('/private/tmp/vibecode-test-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return { dir, file: path.join(dir, 'terminals.json'), preset: path.join(dir, 'preset.json') };
}

function presets(...args) {
    const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', path.join(workspaces, 'presets.js'), workspaces, ...args],
        { encoding: 'utf8' });
    return { status: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

const save = (files, repo, preset) => {
    fs.writeFileSync(files.preset, JSON.stringify(preset));
    return presets('save', files.dir, repo, files.preset);
};
const stored = (files) => JSON.parse(fs.readFileSync(files.file, 'utf8'));

// Der Wizard selbst, direkt ausgewertet: so entsteht der erwartete Befehl, ohne ihn nachzubauen.
function wizard(expression) {
    return JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-'], {
        input: `${wizardSource}\nfunction run() { return JSON.stringify(${expression}); }`, encoding: 'utf8' }).trim());
}

const TERMINALS = [
    { name: 'Frontend', type: 'Eigener Befehl', prompt: 'npm run dev', cwd: 'frontend' },
    { name: 'Claude', type: 'Claude Code', prompt: 'Räum auf: it\'s "wichtig" $(rm -rf ~) `x`', cwd: '' },
    { name: 'Codex 1', type: 'Codex', prompt: '', cwd: '' },
    { name: 'Shell', type: 'Shell', prompt: 'wird ignoriert', cwd: 'tools' },
];

test('Standard-Terminals kommen aus dem Wizard, lokal und remote', () => {
    const result = presets('defaults');
    assert.equal(result.status, 0, result.err);
    const defaults = JSON.parse(result.out);
    const strip = (list) => list.map(({ name, type, prompt, cwd }) => ({ name, type, prompt, cwd }));
    assert.deepEqual(defaults.local, strip(wizard('defaultTerminals(false)')));
    assert.deepEqual(defaults.remote, strip(wizard('defaultTerminals(true)')));
    assert.deepEqual(defaults.local.map((t) => t.name), ['Frontend', 'Storybook', 'Claude', 'Codex 1', 'Codex 2']);
});

test('Speichern schreibt genau die Befehle, die der Wizard selbst bauen würde (auch mit bösen Prompts)', (t) => {
    const files = fixture(t);
    const result = save(files, '/repo/a', { terminals: TERMINALS, urls: ['http://localhost:5173', ' https://x.test/a '] });
    assert.equal(result.status, 0, result.err);
    const entry = stored(files).projects['/repo/a'];
    assert.equal(stored(files).version, 2);
    assert.deepEqual(entry.urls, ['http://localhost:5173', 'https://x.test/a']);
    const expected = TERMINALS.map((terminal) => ({
        name: terminal.name, type: terminal.type, cwd: terminal.cwd,
        prompt: terminal.type === 'Shell' ? '' : terminal.prompt,
        command: wizard(`terminalCommand(${JSON.stringify(terminal.type)}, ${JSON.stringify(terminal.type === 'Shell' ? '' : terminal.prompt)}, false)`),
    }));
    assert.deepEqual(entry.terminals, expected);
    assert.ok(entry.terminals[1].command.includes("'Räum auf: it'\\''s \"wichtig\" $(rm -rf ~) `x`'"));   // sicher gequotet
    assert.deepEqual(JSON.parse(result.out).terminals.map((x) => x.name), ['Frontend', 'Claude', 'Codex 1', 'Shell']);
    assert.ok(!('command' in JSON.parse(result.out).terminals[0]));                  // der Befehl bleibt abgeleitet
});

test('Remote-Repositories bekommen bash statt zsh', (t) => {
    const files = fixture(t);
    const remote = 'vscode-remote://ssh-remote+spark/home/example/repo';
    assert.equal(save(files, remote, { terminals: [{ name: 'Shell', type: 'Shell', prompt: '', cwd: '' },
        { name: 'Codex', type: 'Codex', prompt: '', cwd: '' }], urls: [] }).status, 0);
    const [shell, codex] = stored(files).projects[remote].terminals;
    assert.equal(shell.command, wizard('terminalCommand("Shell", "", true)'));
    assert.equal(shell.command, 'exec bash -l');
    assert.equal(codex.command, wizard('terminalCommand("Codex", "", true)'));
    assert.ok(codex.command.includes('exec bash -l'));
});

test('Namen werden ergänzt, andere Repositories und Version-1-Einträge bleiben erhalten', (t) => {
    const files = fixture(t);
    const legacy = [{ name: 'Alt', type: 'Shell', prompt: '', command: 'exec zsh -l', cwd: '' }];
    fs.writeFileSync(files.file, JSON.stringify({ version: 1, projects: { '/repo/legacy': legacy,
        '/repo/v2': { terminals: legacy, urls: ['http://a.test'] } } }));
    assert.equal(save(files, '/repo/neu', { terminals: [{ name: '  ', type: 'Codex 2', prompt: '', cwd: '' }], urls: [] }).status, 0);
    const data = stored(files);
    assert.equal(data.version, 2);
    assert.deepEqual(data.projects['/repo/legacy'], { terminals: legacy, urls: [] });         // v1 -> v2, Inhalt unverändert
    assert.deepEqual(data.projects['/repo/v2'], { terminals: legacy, urls: ['http://a.test'] });
    assert.equal(data.projects['/repo/neu'].terminals[0].name, 'Codex 2');                    // leer = Typ
    assert.deepEqual(JSON.parse(presets('list', files.dir).out).map((p) => p.path), ['/repo/legacy', '/repo/v2', '/repo/neu']);
});

test('Zurücksetzen entfernt nur dieses Preset und ist wiederholbar', (t) => {
    const files = fixture(t);
    save(files, '/repo/a', { terminals: TERMINALS.slice(0, 1), urls: [] });
    save(files, '/repo/b', { terminals: TERMINALS.slice(0, 1), urls: [] });
    assert.equal(presets('reset', files.dir, '/repo/a').out, 'ok');
    assert.deepEqual(Object.keys(stored(files).projects), ['/repo/b']);
    const before = fs.readFileSync(files.file, 'utf8');
    assert.equal(presets('reset', files.dir, '/repo/a').status, 0);                         // gibt es nicht mehr: kein Fehler
    assert.equal(fs.readFileSync(files.file, 'utf8'), before);                              // und nichts geschrieben
    assert.equal(presets('list', fixture(t).dir).out, '[]');                                // ohne Datei: leere Liste
});

test('ungültige Eingaben werden mit klarem Grund abgelehnt und schreiben nichts', (t) => {
    const files = fixture(t);
    const one = (overrides) => ({ terminals: [Object.assign({ name: 'T', type: 'Shell', prompt: '', cwd: '' }, overrides)], urls: [] });
    const cases = [
        [one({ type: 'Hacker' }), /unbekannter Typ/],
        [one({ type: 'Eigener Befehl', prompt: '   ' }), /Shell-Befehl/],
        [one({ cwd: '../draussen' }), /relativen Unterordner/],
        [one({ cwd: 'a/../b' }), /relativen Unterordner/],
        [one({ cwd: '/etc' }), /relativen Unterordner/],
        [one({ cwd: '~/x' }), /relativen Unterordner/],
        [one({ cwd: 'a\u0007b' }), /relativen Unterordner/],
        [one({ name: 'x'.repeat(61) }), /Name zu lang/],
        [one({ name: 5 }), /ungültige Angaben/],
        [{ terminals: [one({ name: 'Gleich' }).terminals[0], one({ name: 'Gleich' }).terminals[0]], urls: [] }, /heißen „Gleich“/],
        [{ terminals: Array.from({ length: 13 }, (_, i) => ({ name: `T${i}`, type: 'Shell', prompt: '', cwd: '' })), urls: [] }, /Höchstens 12/],
        [{ terminals: [], urls: ['localhost:5173'] }, /http:\/\/ oder https:\/\//],
        [{ terminals: [], urls: ['javascript:alert(1)'] }, /http:\/\/ oder https:\/\//],
        [{ terminals: [], urls: [5] }, /Ungültiger Browser-Tab/],
        [{ terminals: 'nein', urls: [] }, /braucht terminals und urls/],
        [null, /braucht terminals und urls/],
    ];
    for (const [preset, expected] of cases) {
        const result = save(files, '/repo/a', preset);
        assert.notEqual(result.status, 0, JSON.stringify(preset));
        assert.match(result.err, expected, JSON.stringify(preset));
    }
    assert.ok(!fs.existsSync(files.file));                                                  // nie etwas geschrieben
    for (const bad of ['', '  ', 'a\nb']) assert.notEqual(save(files, bad, one({})).status, 0, JSON.stringify(bad));
});

test('eine beschädigte terminals.json wird nie ersetzt', (t) => {
    const files = fixture(t);
    const valid = { terminals: TERMINALS.slice(0, 1), urls: [] };
    for (const bad of ['{kaputt', '[]', '{"version": 9, "projects": {}}', '{"version": 2, "projects": []}',
        JSON.stringify({ version: 2, projects: { '/r': { terminals: [{ name: 'x', type: 'Nix', prompt: '', command: '', cwd: '' }], urls: [] } } }),
        JSON.stringify({ version: 2, projects: { '/r': { terminals: [], urls: [''] } } })]) {
        fs.writeFileSync(files.file, bad);
        for (const attempt of [() => save(files, '/repo/a', valid), () => presets('reset', files.dir, '/r'), () => presets('list', files.dir)]) {
            assert.notEqual(attempt().status, 0, bad);
        }
        assert.equal(fs.readFileSync(files.file, 'utf8'), bad);
    }
});

test('auf einem frischen Mac wird der Konfigurationsordner beim ersten Speichern angelegt', (t) => {
    const files = fixture(t);
    const fresh = path.join(files.dir, 'noch', 'nicht', 'da');
    fs.writeFileSync(files.preset, JSON.stringify({ terminals: TERMINALS.slice(0, 1), urls: [] }));
    const result = presets('save', fresh, '/repo/a', files.preset);
    assert.equal(result.status, 0, result.err);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(fresh, 'terminals.json'), 'utf8')).projects), ['/repo/a']);
});
