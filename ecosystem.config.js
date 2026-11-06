// pm2 process list for the Brembo server.
// With the release folders made by scripts/deploy.sh / deploy.ps1 (recommended), the deploy script
// starts and reloads everything itself. By hand, from the app folder:
//   pm2 startOrReload ecosystem.config.js && pm2 save
// OPL_APP_DIR (set by the deploy script) is the stable "current" link, so pm2 always runs the
// release the link points to; OPL_PORT and OPL_PREFIX let a second copy (a test server) run beside it.
// - opl-tracker: the web app, 2 copies (cluster mode) so `pm2 reload` restarts them one at a time
//   and nobody sees the app go down during an update.
// - routine morning digest emails are disabled; the daily status remains available in the app.
// - opl-weekly: the weekly report email to admins and managers, Monday 09:00.
// - opl-archive: archives issues closed more than a year ago, Sunday 23:45.
// - opl-backup: a full copy of the data (and proof files) every night at 23:30.
// - opl-health: checks the app every 5 minutes and posts to Teams when it is down or backups stop.
const NODE_ARGS = '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON';
const cwd = process.env.OPL_APP_DIR || __dirname;
const port = process.env.OPL_PORT || '3000';
const prefix = process.env.OPL_PREFIX || 'opl';
const env = { OPL_PORT: port, ...(process.env.OPL_STATE_DIR ? { OPL_STATE_DIR: process.env.OPL_STATE_DIR } : {}) };

module.exports = {
  apps: [
    {
      name: `${prefix}-tracker`,
      cwd,
      script: 'node_modules/next/dist/bin/next',
      args: `start -p ${port}`,
      exec_mode: 'cluster',
      instances: 2,
      max_memory_restart: '700M',
      kill_timeout: 8000,
      listen_timeout: 15000,
      env: { NODE_ENV: 'production', ...env },
    },
    {
      name: `${prefix}-weekly`,
      cwd,
      script: 'scripts/daily-digest.mjs',
      args: '--weekly',
      node_args: NODE_ARGS,
      cron_restart: '0 9 * * 1',
      autorestart: false,
      env,
    },
    {
      name: `${prefix}-archive`,
      cwd,
      script: 'scripts/archive.mjs',
      node_args: NODE_ARGS,
      cron_restart: '45 23 * * 0',
      autorestart: false,
      env,
    },
    {
      name: `${prefix}-backup`,
      cwd,
      script: 'scripts/backup.mjs',
      node_args: NODE_ARGS,
      cron_restart: '30 23 * * *',
      autorestart: false,
      env,
    },
    {
      name: `${prefix}-health`,
      cwd,
      script: 'scripts/health-alert.mjs',
      node_args: NODE_ARGS,
      cron_restart: '*/5 * * * *',
      autorestart: false,
      env,
    },
  ],
};
