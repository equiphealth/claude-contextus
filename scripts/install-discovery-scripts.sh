#!/usr/bin/env bash
# install-discovery-scripts.sh
# Installs contextus discovery scripts to ~/.contextus/scripts/ (fixed known location).
# Called by contextus-setup and contextus-upgrade to ensure skills can find contextus.
#
# Idempotent: safe to run multiple times, overwrites existing files with updates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.contextus/scripts"

# List of scripts to install (add new discovery scripts here)
SCRIPTS=(
    "daemon-config.sh"
    "find-contextus-root.sh"
    "daemon-url.sh"
)

echo "Installing contextus discovery scripts to ${INSTALL_DIR}..."

# Create target directory
mkdir -p "$INSTALL_DIR"

# Copy each script
for script in "${SCRIPTS[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$script" ]; then
        echo "⚠ Warning: $script not found in $SCRIPT_DIR, skipping"
        continue
    fi

    cp "$SCRIPT_DIR/$script" "$INSTALL_DIR/"

    # Make .sh files executable
    if [[ "$script" == *.sh ]]; then
        chmod +x "$INSTALL_DIR/$script"
    fi

    echo "  ✓ $script"
done

echo ""
echo "Discovery scripts installed. Skills can now use:"
echo "  bash ~/.contextus/scripts/find-contextus-root.sh"
