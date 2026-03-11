const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

contextBridge.exposeInMainWorld('electronAPI', {
    // Select a single image file
    selectSingleImage: () => ipcRenderer.invoke('select-single-image'),
    
    // Select multiple images (legacy)
    selectImages: () => ipcRenderer.invoke('select-images'),
    
    // Select output folder
    selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
    
    // Get API URL
    getApiUrl: () => ipcRenderer.invoke('get-api-url'),
    
    // Read file as base64
    readFile: (filePath) => {
        const buffer = fs.readFileSync(filePath);
        return buffer.toString('base64');
    },
    
    // Get file name from path
    getFileName: (filePath) => path.basename(filePath),
    
    // Write file from base64
    writeFile: (filePath, data) => {
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
        return true;
    },
    
    // Check if file exists
    fileExists: (filePath) => fs.existsSync(filePath),
    
    // Get file info
    getFileInfo: (filePath) => {
        try {
            const stats = fs.statSync(filePath);
            return {
                exists: true,
                size: stats.size,
                name: path.basename(filePath),
                directory: path.dirname(filePath)
            };
        } catch (e) {
            return { exists: false, error: e.message };
        }
    }
});
