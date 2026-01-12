# ClassroomPath - Claude Instructions

## CRITICAL: OpenPath Editing Rules

**NEVER edit files in `upstream/openpath/`** - This is a git submodule.

### Where to make OpenPath changes:

| Want to change... | Edit in... |
|-------------------|------------|
| API code (`api/`) | `/datos_replicados/Bruno/Whitelist/OpenPath/api/` |
| SPA code (`spa/`) | `/datos_replicados/Bruno/Whitelist/OpenPath/spa/` |
| Shared code | `/datos_replicados/Bruno/Whitelist/OpenPath/shared/` |
| ClassroomPath deployment | This repo (`ClassroomPath/`) |

### Why?

```
upstream/openpath/  ← READ-ONLY submodule (changes here get lost)
                      Points to: github.com/balejosg/openpath.git

/datos_replicados/Bruno/Whitelist/OpenPath/  ← EDIT HERE
                                               Same remote, but your changes persist
```

### Quick check before editing:

If the file path contains `upstream/openpath/`, **STOP** and use the equivalent path in `/datos_replicados/Bruno/Whitelist/OpenPath/` instead.

## What IS safe to edit in ClassroomPath:

- `docker/` - Docker configuration
- `config/` - Environment templates
- `.github/workflows/` - CI/CD
- `spa/src/` - ClassroomPath-specific SPA extensions
- `tests/` - Deployment tests
