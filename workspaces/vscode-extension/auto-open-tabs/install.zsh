#!/bin/zsh
set -euo pipefail

# Eine reguläre VSIX-Installation registriert die Erweiterung auch dann wieder,
# wenn VS Code sie zuvor in .obsolete als deinstalliert markiert hat.
EDITOR_CLI="${1:?Editor-CLI fehlt}"
EXTENSION_DIR="${0:A:h}"
PACKAGE_DIR="$(mktemp -d)"
trap '/bin/rm -rf "$PACKAGE_DIR"' EXIT

mkdir -p "$PACKAGE_DIR/extension"
/bin/cp "$EXTENSION_DIR/package.json" "$EXTENSION_DIR/extension.js" "$PACKAGE_DIR/extension/"
/bin/cp "$EXTENSION_DIR/[Content_Types].xml" "$EXTENSION_DIR/extension.vsixmanifest" "$PACKAGE_DIR/"
(
  cd "$PACKAGE_DIR"
  /usr/bin/zip -q -r "$PACKAGE_DIR/vibecode-workspace.vsix" \
    extension '[Content_Types].xml' extension.vsixmanifest
)
"$EDITOR_CLI" --install-extension "$PACKAGE_DIR/vibecode-workspace.vsix" --force
