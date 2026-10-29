const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname,
    '../workspaces/vscode-extension/auto-open-tabs/extension.js'), 'utf8');

async function terminalOptions(definition) {
    let options;
    const vscode = {
        TerminalLocation: { Panel: 1 },
        ThemeColor: class { constructor(id) { this.id = id; } },
        ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
        workspace: {
            isTrusted: true,
            getConfiguration: () => ({ get: key => key === 'autoStartTerminals'
                ? [{ name: 'Lifecycle test', ...definition }] : [] }),
        },
        window: {
            terminals: [],
            createTerminal: value => {
                options = value;
                return { processId: Promise.resolve(123), show() {} };
            },
            showWarningMessage: message => assert.fail(message),
            showErrorMessage: message => assert.fail(message),
        },
    };
    const sandbox = {
        module: { exports: {} }, URL, setTimeout, clearTimeout,
        require: name => name === 'vscode' ? vscode : require(name),
    };
    vm.runInNewContext(source, sandbox);
    await sandbox.module.exports.activate({ subscriptions: [] });
    assert.ok(options, 'the extension must create the configured terminal');
    return options;
}

// A real PTY sends Ctrl+C to the foreground process group, as VS Code does.
// Isolated startup files avoid running the user's interactive shell customizations.
const ptyProbe = String.raw`
import errno, json, os, pty, select, signal, sys, tempfile, time

case = json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix='vibecode-zdot-') as zdotdir:
    pid, master = pty.fork()
    if pid == 0:
        os.environ['ZDOTDIR'] = zdotdir
        os.environ['TERM'] = 'xterm-256color'
        os.execv(case['shellPath'], [case['shellPath']] + case['shellArgs'])
    output = bytearray()
    waited = False

    def read_once(timeout):
        if not select.select([master], [], [], timeout)[0]:
            return True
        try:
            data = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                return False
            raise
        output.extend(data)
        return bool(data)

    def read_until(needle):
        deadline = time.monotonic() + 5
        while needle not in output:
            if time.monotonic() >= deadline or not read_once(0.1):
                raise AssertionError('Terminal did not remain usable: ' + repr(bytes(output)))

    try:
        if case.get('interrupt'):
            read_until(b'__TASK_STARTED__')
            time.sleep(0.15)
            os.write(master, b'\x03')
        if not case.get('close'):
            # The echoed input contains $$; only a running shell can produce its PID.
            os.write(master, b"printf '__SHELL_ALIVE=%s__\\n' $$\n")
            read_until(('__SHELL_ALIVE=' + str(pid) + '__').encode())
            os.write(master, b'exit\n')
        deadline = time.monotonic() + 5
        while True:
            completed, status = os.waitpid(pid, os.WNOHANG)
            if completed:
                waited = True
                break
            if time.monotonic() >= deadline:
                raise AssertionError('Terminal did not exit after probe: ' + repr(bytes(output)))
            read_once(0.1)
        print(json.dumps({'exitCode': os.waitstatus_to_exitcode(status),
                          'output': output.decode(errors='replace')}))
    finally:
        # Also remove any surviving foreground child when an assertion fails.
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        if not waited:
            os.waitpid(pid, 0)
        os.close(master)
`;

function probe(options, mode = {}) {
    return JSON.parse(execFileSync('python3', ['-c', ptyProbe], {
        input: JSON.stringify({ shellPath: options.shellPath, shellArgs: options.shellArgs, ...mode }),
        encoding: 'utf8', timeout: 15000,
    }));
}

test('a failed startup command leaves a usable shell in the same terminal process', async () => {
    const result = probe(await terminalOptions({ command: 'false' }));
    assert.equal(result.exitCode, 0);
});

test('Ctrl+C stops a foreground command and keeps the terminal shell usable', async () => {
    const options = await terminalOptions({ command: "printf '__TASK_STARTED__\\n'; sleep 60" });
    assert.equal(probe(options, { interrupt: true }).exitCode, 0);
});

test('Ctrl+C also keeps the shell open when the startup command uses exec', async () => {
    const options = await terminalOptions({ command: "printf '__TASK_STARTED__\\n'; exec sleep 60" });
    assert.equal(probe(options, { interrupt: true }).exitCode, 0);
});

test('remote bash terminals survive both command failures and Ctrl+C', async () => {
    assert.equal(probe(await terminalOptions({ command: 'false', shellPath: '/bin/bash' })).exitCode, 0);
    const options = await terminalOptions({
        command: "printf '__TASK_STARTED__\\n'; exec sleep 60", shellPath: '/bin/bash',
    });
    assert.equal(probe(options, { interrupt: true }).exitCode, 0);
});

test('terminals configured to close retain the raw command and its exit status', async () => {
    const command = 'exit 7';
    const options = await terminalOptions({ command, close: true });
    assert.equal(options.shellArgs[2], command);
    assert.equal(probe(options, { close: true }).exitCode, 7);
});

test('the persistent terminal preserves literal process arguments', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecode-lifecycle-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const marker = path.join(directory, 'must-not-exist');
    const literal = `quotes ' and $(touch ${marker}) and\nnew line`;
    const options = await terminalOptions({ type: 'process', command: '/usr/bin/printf', args: ['%s\n', literal] });
    const result = probe(options);
    assert.ok(result.output.includes(literal.replaceAll('\n', '\r\n')));
    assert.equal(fs.existsSync(marker), false);
    assert.equal(result.exitCode, 0);
});
