const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');

let mainWindow;
let pythonProcess;
const API_URL = 'http://127.0.0.1:8001';
const VENV_PYTHON = 'I:\\NSU\\technohack\\ovenv\\Scripts\\python.exe';

function findPython() {
    if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
    return process.platform === 'win32' ? 'py' : 'python3';
}

async function killPort(port) {
    return new Promise(resolve => {
        if (process.platform === 'win32') {
            exec(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`, () => {
                setTimeout(resolve, 1000);
            });
        } else {
            resolve();
        }
    });
}

async function startBackend() {
    await killPort(8001);
    
    const backendDir = path.join(__dirname, '..', 'backend');
    const python = findPython();
    
    console.log('=== Starting Backend ===');
    console.log('Python:', python);
    console.log('Dir:', backendDir);
    
    pythonProcess = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8001'], {
        cwd: backendDir,
        shell: true,
        stdio: 'pipe'
    });
    
    pythonProcess.stdout.on('data', d => process.stdout.write(d));
    pythonProcess.stderr.on('data', d => process.stderr.write(d));
    pythonProcess.on('error', e => console.error('Process error:', e));
    pythonProcess.on('close', c => console.log('Process closed:', c));
    
    // Wait for backend
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
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        backgroundColor: '#1a1a2e',
        show: false,
        resizable: true,
        minimizable: true,
        maximizable: true
    });
    
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    console.log('Loading HTML:', htmlPath);
    
    mainWindow.loadFile(htmlPath)
        .then(() => console.log('HTML loaded'))
        .catch(e => console.error('Load error:', e));
    
    mainWindow.once('ready-to-show', () => mainWindow.show());
}

// IPC Handlers

// Select a single image file
ipcMain.handle('select-single-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите изображение',
        properties: ['openFile'],
        filters: [{ 
            name: 'Images', 
            extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp'] 
        }]
    });
    
    if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
    }
    
    const filePath = result.filePaths[0];
    return {
        canceled: false,
        filePath: filePath,
        fileName: path.basename(filePath)
    };
});

// Select multiple images (legacy)
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

// App lifecycle
app.whenReady().then(async () => {
    const ok = await startBackend();
    if (!ok) {
        dialog.showErrorBox('Error', 'Backend failed to start');
        app.quit();
        return;
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
