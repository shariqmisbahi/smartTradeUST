module.exports = {
  apps: [
    {
      name: 'trade-surveillance-backend',
      script: './app/start_backend.sh',
      cwd: '/home/ubuntu/trade-surveillance',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5294,
        PYTHONPATH: '/home/ubuntu/trade-surveillance/app',
        DATABASE_URL: 'sqlite:///data/trades.db',
        DEBUG: 'False'
      },
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_file: './logs/backend-combined.log',
      time: true
    },
    {
      name: 'trade-surveillance-streamlit',
      script: './app/start_streamlit.sh',
      cwd: '/home/ubuntu/trade-surveillance',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        STREAMLIT_SERVER_PORT: 8501,
        STREAMLIT_SERVER_ADDRESS: '0.0.0.0',
        STREAMLIT_SERVER_HEADLESS: 'true',
        STREAMLIT_SERVER_ENABLE_CORS: 'false',
        STREAMLIT_SERVER_ENABLE_XSRF_PROTECTION: 'false',
        PYTHONPATH: '/home/ubuntu/trade-surveillance/app',
        DATABASE_URL: 'sqlite:///data/trades.db'
      },
      error_file: './logs/streamlit-error.log',
      out_file: './logs/streamlit-out.log',
      log_file: './logs/streamlit-combined.log',
      time: true
    }
  ],

  deploy: {
    production: {
      user: 'ubuntu',
      host: 'your-ec2-ip',
      ref: 'origin/main',
      repo: 'https://github.com/your-username/trade-surveillance.git',
      path: '/home/ubuntu/trade-surveillance',
      'pre-deploy-local': '',
      'post-deploy': 'cd app && source venv/bin/activate && pip install -r ../requirements.txt && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
}; 