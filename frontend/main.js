const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');

let mainWindow;
let pythonProcess;
let API_URL = 'http://127.0.0.1:8001';

function findFreePort() {
    return new Promise((resolve, reject) => {
        const net = require('net');
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

function getPythonCommand() {
    const backendDir = path.resolve(__dirname, '..', 'backend');
    // Prefer uv-managed venv inside backend/
    if (process.platform === 'win32') {
        const venvPy = path.join(backendDir, '.venv', 'Scripts', 'python.exe');
        if (fs.existsSync(venvPy)) return venvPy;
        return 'python';
    } else {
        const venvPy = path.join(backendDir, '.venv', 'bin', 'python');
        if (fs.existsSync(venvPy)) return venvPy;
        return 'python3';
    }
}

async function startBackend() {
    const port = await findFreePort();
    API_URL = `http://127.0.0.1:${port}`;
    console.log(`=== Using port ${port} ===`);
    
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'backend.exe' : 'backend';
    
    // Check for compiled binary (Production inside asar resources, or Dev compiled in dist)
    const binaryPathProd = path.join(process.resourcesPath, 'backend', binaryName);
    const binaryPathDev = path.resolve(__dirname, '..', 'backend', 'dist', binaryName);
    
    const isFrozen = app.isPackaged;

    if (isFrozen) {
        // Production: use compiled Nuitka binary
        const binaryPath = fs.existsSync(binaryPathProd) ? binaryPathProd : binaryPathDev;
        if (!binaryPath || !fs.existsSync(binaryPath)) {
            console.error('Compiled backend binary not found!');
            return false;
        }
        console.log('=== Starting Compiled Backend ===');
        console.log('Executable:', binaryPath);
        pythonProcess = spawn(binaryPath, [], {
            cwd: path.dirname(binaryPath),
            shell: false,
            stdio: 'pipe',
            env: { ...process.env, PORT: String(port) }
        });
    } else {
        // Dev: always use Python + uvicorn
        const backendDir = path.resolve(__dirname, '..', 'backend');
        const python = getPythonCommand();
        console.log('=== Starting Python Backend (Dev) ===');
        console.log('Python:', python, 'Port:', port);

        if (!fs.existsSync(backendDir)) {
            console.error('Backend directory not found!');
            return false;
        }

        pythonProcess = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port)], {
            cwd: backendDir,
            shell: true,
            stdio: 'pipe',
            env: { ...process.env, PORT: String(port) }
        });
    }
    
    pythonProcess.stdout.on('data', d => process.stdout.write(d));
    pythonProcess.stderr.on('data', d => process.stderr.write(d));
    pythonProcess.on('error', e => console.error('Process error:', e));
    pythonProcess.on('close', c => console.log('Process closed:', c));
    
    const http = require('http');
    for (let i = 0; i < 30; i++) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(API_URL, res => res.statusCode === 200 ? resolve() : reject());
                req.on('error', reject);
                req.setTimeout(500, () => { req.destroy(); reject(); });
            });
            console.log('=== Backend Ready ===');
            return true;
        } catch (e) {
            console.log(`Waiting ${i + 1}/30...`);
            await new Promise(r => setTimeout(r, 500));
        }
    }
    return false;
}

function createWindow() {
    const preloadPath = path.resolve(__dirname, 'preload.js');
    const htmlPath = path.resolve(__dirname, 'public', 'index.html');
    
    console.log('=== Creating Window ===');
    console.log('Preload path:', preloadPath);
    console.log('HTML path:', htmlPath);
    
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: preloadPath,
            sandbox: false,
            webSecurity: true
        },
        backgroundColor: '#1a1a2e',
        show: false,
        resizable: true,
        minimizable: true,
        maximizable: true
    });
    
    // Only open DevTools in development mode
    if (process.argv.includes('--dev') || process.env.DEV === '1') {
        mainWindow.webContents.openDevTools();
    }
    
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Page finished loading');
    });
    
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load page:', errorCode, errorDescription);
    });
    
    // Log console messages from renderer
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log('[Renderer]', message);
    });
    
    mainWindow.loadFile(htmlPath)
        .then(() => console.log('HTML loaded successfully'))
        .catch(e => console.error('Load error:', e));
    
    mainWindow.once('ready-to-show', () => mainWindow.show());
}

function loadEditorPage() {
    const appHtmlPath = path.resolve(__dirname, 'public', 'app.html');
    console.log('=== Loading Editor Page ===');
    console.log('Path:', appHtmlPath);
    console.log('Exists:', fs.existsSync(appHtmlPath));
    
    if (fs.existsSync(appHtmlPath)) {
        mainWindow.loadFile(appHtmlPath)
            .then(() => console.log('Editor page loaded'))
            .catch(e => console.error('Failed to load editor:', e));
    } else {
        console.error('app.html not found at:', appHtmlPath);
    }
}

// IPC Handlers

ipcMain.handle('select-single-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите изображение',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp'] }]
    });
    
    if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
    }
    
    return {
        canceled: false,
        filePath: result.filePaths[0],
        fileName: path.basename(result.filePaths[0])
    };
});

ipcMain.handle('select-images', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select 4 Images',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp'] }]
    });
    
    if (result.canceled || result.filePaths.length < 4) {
        return { canceled: true };
    }
    
    const files = result.filePaths.sort();
    let ppl45, ppl90, xpl45, xpl90;
    
    files.forEach(f => {
        const name = path.basename(f).toLowerCase();
        if (name.includes('ppl') && name.includes('45')) ppl45 = f;
        else if (name.includes('ppl') && name.includes('90')) ppl90 = f;
        else if (name.includes('xpl') && name.includes('45')) xpl45 = f;
        else if (name.includes('xpl') && name.includes('90')) xpl90 = f;
    });
    
    if (!ppl45 || !ppl90 || !xpl45 || !xpl90) {
        return { canceled: false, needsAssignment: true, files };
    }
    
    return { canceled: false, ppl45, ppl90, xpl45, xpl90 };
});

ipcMain.handle('select-output-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? { canceled: true } : { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle('get-api-url', () => API_URL);

ipcMain.handle('open-editor', () => {
    console.log('=== IPC: open-editor called ===');
    loadEditorPage();
    return { success: true };
});

// App lifecycle
app.whenReady().then(async () => {
    console.log('App ready, starting backend...');
    
    const ok = await startBackend();
    if (!ok) {
        console.error('Backend failed to start');
        dialog.showErrorBox(
            'Backend Error', 
            'Failed to start Python backend.\n\n' +
            'Make sure you run start.bat after activating your venv:\n' +
            '  ovenv\\Scripts\\activate\n' +
            '  .\\start.bat\n\n' +
            'And uvicorn is installed:\n' +
            '  pip install uvicorn fastapi'
        );
    }
    
    createWindow();
});

app.on('window-all-closed', () => {
    if (pythonProcess) pythonProcess.kill();
    app.quit();
});

app.on('before-quit', () => {
    if (pythonProcess) pythonProcess.kill();
});
