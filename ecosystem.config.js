module.exports = {
  apps: [
    {
      name: 'journal-correction-backend',
      cwd: '/home/krttpt/journal/backend',
      script: 'index.js',
      env: { NODE_ENV: 'production', PORT: 5180 },
      max_memory_restart: '300M',
      error_file: '/home/krttpt/journal/backend/.pm2-err.log',
      out_file: '/home/krttpt/journal/backend/.pm2-out.log',
    },
  ],
};
