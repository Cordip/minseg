# PyArmor + PyInstaller → Nuitka Migration

## Goal

Replace PyArmor (source obfuscation) and PyInstaller (binary packaging) with Nuitka, which compiles Python to native C code and produces a standalone binary in one step. This eliminates PyArmor's 32KB per-file trial limit that blocks the build.

## Background

The backend (`main.py`, 35KB) exceeds PyArmor trial's ~32KB per-file limit after the tag tree panel feature was added. Rather than purchasing a PyArmor license or splitting files to work around the limit, we replace the entire PyArmor + PyInstaller chain with Nuitka.

## What Nuitka Does

Nuitka compiles Python source to C, then to native machine code via GCC/MSVC. The result is a standalone binary with all dependencies bundled. No `.pyc` bytecode remains — reversing requires disassembly, which is significantly harder than reversing PyArmor-obfuscated bytecode.

## Architecture Change

### Before (6 build steps)

```
PyArmor obfuscate → PyInstaller freeze → npm install → bytenode → js-obfuscator → electron-builder
```

### After (5 build steps)

```
Nuitka compile → npm install → bytenode → js-obfuscator → electron-builder
```

## Python Version Compatibility

The project uses Python 3.14 (`requires-python = ">=3.14"` in `pyproject.toml`). Nuitka support for Python 3.14 must be verified before implementation. If Nuitka does not yet support 3.14, the fallback is to temporarily pin `requires-python = ">=3.12"` and use a compatible Python version for the build, or wait for Nuitka to add 3.14 support.

## Nuitka Command

```bash
python -m nuitka \
  --onefile \
  --output-dir=dist \
  --output-filename=backend \
  --python-flag=no_docstrings \
  --follow-import-to=aligner,segmentation,undo \
  --nofollow-import-to=pytest,setuptools,pip,pyarmor \
  --include-module=cv2 \
  --include-module=numpy \
  --include-module=scipy \
  --include-module=skimage \
  --include-module=fastapi \
  --include-module=uvicorn \
  --include-module=pydantic \
  --include-module=starlette \
  --include-module=anyio \
  --include-module=multipart \
  --include-module=h11 \
  --include-module=PIL \
  main.py
```

- `--onefile`: produces a single standalone executable with all dependencies (implies `--standalone`)
- `--follow-import-to`: compiles project modules (aligner, segmentation, undo) to native C
- `--python-flag=no_docstrings`: strips docstrings (minor size/protection benefit)
- `--nofollow-import-to`: excludes dev-only packages from the build
- `--include-module` for starlette, anyio, multipart, h11, PIL: transitive dependencies that Nuitka may not auto-discover (FastAPI loads starlette dynamically; uvicorn requires h11; file uploads need multipart; skimage uses PIL)

### Output Path

With `--onefile --output-dir=dist --output-filename=backend`, Nuitka places the binary at `dist/backend` (Linux) or `dist/backend.exe` (Windows). Nuitka also creates temporary build directories (`main.build/`, `main.onefile-build/`, `main.dist/`) which should be cleaned up before each build. The final binary path matches what `frontend/package.json` `extraResources` expects (`../backend/dist/backend`).

### Startup Time

`--onefile` self-extracts to a temp directory on each launch. With heavy dependencies (numpy, scipy, cv2, skimage), this may add 2-5 seconds to startup. This is acceptable for a desktop app that starts once per session. If startup time becomes a problem, switch to `--standalone` (directory mode) and update `frontend/package.json` `extraResources` to bundle the directory.

### Build Time

Nuitka compilation is significantly slower than PyArmor + PyInstaller. Expect 15-45 minutes for the initial build (C compilation of all dependencies). Subsequent builds with `--cache-mode` may be faster if only project files change.

## Files to Remove

| File | Reason |
|------|--------|
| `backend/backend.spec` | PyInstaller spec file, no longer needed |
| `backend/dist/pyarmor_dist/` | PyArmor intermediate output directory |

## Files to Modify

### `build.sh` (Linux)

Replace steps 1 (PyArmor) and 2 (PyInstaller) with a single Nuitka step. Remove `pyarmor_runtime_*` discovery logic and PyInstaller fallback path checks. Adjust step numbering from 6 to 5. Clean up Nuitka temp directories before build.

### `build.bat` (Windows)

Same changes as `build.sh`, adapted for Windows: `python -m nuitka` instead of `uv run python -m nuitka`, backslash paths, `backend.exe` output name. Note: the current `build.bat` is missing `undo.py` from the PyArmor command — this is a pre-existing bug that the migration implicitly fixes since Nuitka follows imports automatically.

### `backend/requirements.txt`

- Remove: `pyarmor>=9.2.3` (line 12)
- Remove: `pyinstaller>=6.3.0` (line 15)
- Add: `nuitka`
- Add: `ordered-set` (recommended by Nuitka for faster compilation)

### `backend/pyproject.toml`

- Remove: `pyarmor>=9.2.3` from `[dependency-groups] dev` (line 23)
- Add: `nuitka` to `[dependency-groups] dev`
- Add: `ordered-set` to `[dependency-groups] dev`
- Note: `pyinstaller` is only in `requirements.txt`, not in `pyproject.toml` — no pyinstaller removal needed here

## Files Unchanged

- `backend/main.py` — no code changes
- `backend/undo.py` — no code changes (keep the extraction, good for readability)
- `backend/aligner.py` — no code changes
- `backend/segmentation.py` — no code changes
- `backend/tests/` — no test changes
- `frontend/package.json` — `extraResources` already expects `../backend/dist/backend`, which matches Nuitka's output path
- `frontend/` — no other frontend changes

## Dependencies

### Added

- `nuitka` (Python package, dev dependency)
- `ordered-set` (Python package, recommended by Nuitka for faster compilation)
- System: C compiler — GCC/G++ on Linux (typically pre-installed), MSVC Build Tools or MinGW on Windows

### Removed

- `pyarmor>=9.2.3` (from requirements.txt and pyproject.toml)
- `pyinstaller>=6.3.0` (from requirements.txt only)

## Testing

No application tests change. Verification after migration:

1. All existing backend tests pass via `uv run python -m pytest tests/`
2. Nuitka build completes without errors
3. `./dist/backend` starts FastAPI on `127.0.0.1:8001`
4. Full AppImage build completes via `./build.sh`
5. AppImage launches, loads images, runs segmentation, tag operations work

## Protection Level

| Aspect | PyArmor Trial | Nuitka Standalone |
|--------|--------------|-------------------|
| Source recovery | Minutes (known unpackers) | Significantly harder (native binary analysis) |
| File size limit | ~32KB per file | None |
| Build complexity | 2 tools (PyArmor + PyInstaller) | 1 tool (Nuitka) |
| Runtime overhead | Slight (bytecode wrapping) | None (native code) |
| Cost | Free (trial) or $56+ (license) | Free (MIT license) |

## Rollback

The old build scripts remain in git history. If Nuitka fails (e.g., Python 3.14 incompatibility), revert the build script changes and restore `backend.spec` from git.
