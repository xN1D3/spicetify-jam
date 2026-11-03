# Universal Automatic Version Bumping Rule

Whenever any code change, feature, bug fix, or refactoring is performed in this repository, you MUST automatically increment the version before finishing the task.

## Rules:
1. **PATCH bump** (`0.0.+1` or `patch + 1`):
   - Bug fixes, hotfixes, UI tweaks, minor logic fixes.
2. **MINOR bump** (`0.+1.0`, reset patch to 0):
   - New features, new UI modules, backward-compatible additions.
3. **MAJOR bump** (`+1.0.0`, reset minor and patch to 0):
   - Breaking architecture changes or incompatible protocol redesign.

## Synchronization Checklist:
Whenever bumping:
- Update `package.json` (`version`)
- Update `manifest.json` (`version` and/or `patch`)
- Update in-code constants in `src/JamContext.tsx` (`CURRENT_VERSION` / `CURRENT_PATCH`)
- Ensure all references are strictly identical.
