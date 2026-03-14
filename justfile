# Mineral Segmentation App — development commands

# List available commands
default:
	@just --list

# ─── Development ──────────────────────────────────────────────

# Run backend API server
[group('dev')]
backend:
	cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8001 --reload

# Run frontend with Tauri dev mode
[group('dev')]
frontend:
	cd frontend && npm run tauri dev

# Install all dependencies
[group('dev')]
install:
	cd backend && uv sync
	cd frontend && npm install

# ─── Testing ─────────────────────────────────────────────────

# Run backend tests
[group('test')]
test:
	cd backend && uv run pytest tests/ -v

# Run backend tests with coverage
[group('test')]
test-cov:
	cd backend && uv run pytest tests/ -v --cov=. --cov-report=term-missing

# Run a single test file
[group('test')]
test-file file:
	cd backend && uv run pytest {{file}} -v

# ─── Building ────────────────────────────────────────────────

# Full protected build (Linux)
[group('build')]
[linux]
build:
	bash build.sh

# Full protected build (Windows)
[group('build')]
[windows]
build:
	cmd /c build.bat

# ─── Run built app ────────────────────────────────────────────

# Launch built app (Linux)
[group('run')]
[linux]
run:
	./frontend/src-tauri/target/release/mineral-segmentation

# Launch built app (Windows)
[group('run')]
[windows]
run:
	frontend\src-tauri\target\release\mineral-segmentation.exe

# ─── Cleanup ─────────────────────────────────────────────────

# Remove backend build artifacts
[group('clean')]
clean-backend:
	rm -rf backend/build backend/dist

# Remove frontend build artifacts
[group('clean')]
clean-frontend:
	rm -rf frontend/dist frontend/src-tauri/target

# Remove all build artifacts
[group('clean')]
clean: clean-backend clean-frontend
