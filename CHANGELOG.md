# Changelog

## 0.1.0

- Status bar selector showing enabled/total modules; enabled modules are pre-checked.
- Explorer right-click and editor right-click to open/close the current module.
- Closed modules are marked with a `⊘` badge (color `#7A8FA3`, customizable via `javaModuleManager.closedModule`).
- Presets: save the current selection and restore it with one command.
- Dependency awareness: warns when closing a module that enabled modules depend on; auto-enables in-workspace dependencies.
- English / Simplified Chinese localization following the VS Code display language.
