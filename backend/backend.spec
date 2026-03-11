# -*- mode: python ; coding: utf-8 -*-
"""
Minimal PyInstaller spec for backend - excludes unnecessary packages
"""

block_cipher = None

# EXCLUDE these heavy packages we don't need
excludes = [
    # GUI frameworks
    'tkinter', '_tkinter', 'Tkinter',
    'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'pyside6', 'pyqt5', 'pyqt6',
    'wx', 'wxPython',
    
    # Jupyter/IPython
    'IPython', 'ipython', 'jupyter', 'notebook', 'ipykernel', 'ipywidgets',
    'jupyter_client', 'jupyter_core', 'nbconvert', 'nbformat',
    
    # Machine Learning (not needed)
    'torch', 'pytorch', 'tensorflow', 'keras', 'transformers', 'huggingface',
    'sklearn', 'scikit-learn', 'xgboost', 'lightgbm', 'catboost',
    
    # Plotting (not needed for API)
    'matplotlib', 'pyplot', 'seaborn', 'plotly', 'bokeh', 'altair',
    
    # Data science extras
    'pandas', 'pandas.plotting', 'pandas.io', 
    'sympy', 'nltk', 'spacy', 'gensim',
    
    # Development tools
    'pytest', 'sphinx', 'docutils', 'pydoc',
    'setuptools', 'pip', 'wheel',
    
    # Cloud services
    'boto3', 'botocore', 'google', 'azure',
    's3fs', 'gcsfs',
    
    # Other unused
    'PIL.ImageQt', 'PIL.SpiderImagePlugin',
    'cv2.gapi', 'cv2.utils',
    'win32com', 'pythoncom', 'pywintypes',
    'sqlalchemy', 'sql',
    'fsspec', 'dask', 'distributed',
    'numba', 'cupy',
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'multipart',
        'multipart.multipart',
        'cv2',
        'numpy',
        'scipy',
        'scipy.ndimage',
        'scipy.stats',
        'scipy.spatial',
        'skimage',
        'skimage.segmentation',
        'skimage.graph',
        'skimage.color',
        'skimage.filters',
        'skimage.feature',
        'skimage.measure',
        'skimage.transform',
        'PIL',
        'PIL.Image',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
