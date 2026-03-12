# Mineral Segmentation App — development commands
# Install just: https://github.com/casey/just

# List available commands
default:
	@just --list

# ─── Development ──────────────────────────────────────────────

# Run backend API server (port 8001)
[group('dev')]
backend:
	cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8001 --reload

# Run frontend Electron app
[group('dev')]
frontend:
	cd frontend && npx electron .

# Install all dependencies (backend + frontend)
[group('dev')]
install:
	cd backend && uv sync
	cd frontend && npm install

# ─── Testing ─────────────────────────────────────────────────

# Run backend tests
[group('test')]
test:
	cd backend && uv run pytest tests/ -v

# Run backend tests with coverage report
[group('test')]
test-cov:
	cd backend && uv run pytest tests/ -v --cov=. --cov-report=term-missing

# Run a single test file (e.g. just test-file tests/test_main.py)
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
	./frontend/dist/Mineral\ Segmentation-*-x86_64.AppImage

# Launch built app (Windows)
[group('run')]
[windows]
run:
	cmd /c frontend\dist\win-unpacked\Mineral\ Segmentation.exe

# ─── Cleanup ─────────────────────────────────────────────────

# Remove backend build artifacts
[group('clean')]
clean-backend:
	rm -rf backend/build backend/dist

# Remove frontend build artifacts
[group('clean')]
clean-frontend:
	rm -rf frontend/dist

# Remove all build artifacts
[group('clean')]
clean: clean-backend clean-frontend
