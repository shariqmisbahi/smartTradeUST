@echo off
echo 🛠️ Trade Surveillance System - Setup
echo ====================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: Python not found
    echo 💡 Please install Python 3.7+ and add it to PATH
    pause
    exit /b 1
)

echo ✅ Python found
python --version

REM Check if virtual environment exists
if exist "venv" (
    echo ✅ Virtual environment already exists
    echo 💡 To recreate it, delete the 'venv' folder and run this script again
) else (
    echo 🔧 Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ❌ Error: Failed to create virtual environment
        pause
        exit /b 1
    )
    echo ✅ Virtual environment created
)

REM Activate virtual environment
echo 🔧 Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo 📦 Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ❌ Error: Failed to install dependencies
    pause
    exit /b 1
)

echo ✅ Dependencies installed successfully

REM Verify installation
echo 🔍 Verifying installation...
python -c "import fastapi, streamlit, pandas, plotly, requests; print('✅ All dependencies verified')" 2>nul
if errorlevel 1 (
    echo ⚠️ Warning: Some dependencies may not be properly installed
) else (
    echo ✅ All dependencies verified successfully
)

echo.
echo 🎉 Setup completed successfully!
echo.
echo 🚀 To start the system, run:
echo    venv\Scripts\activate
echo    cd app
echo    python main.py
echo.

REM Deactivate virtual environment
 