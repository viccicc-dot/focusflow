import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const databasePath = path.resolve(process.cwd(), 'data', 'focusflow-e2e.db');
const uploadDir = path.resolve(process.cwd(), 'uploads-e2e');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
fs.rmSync(databasePath, { force: true });
fs.rmSync(`${databasePath}-shm`, { force: true });
fs.rmSync(`${databasePath}-wal`, { force: true });
fs.rmSync(uploadDir, { recursive: true, force: true });

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_PATH: databasePath,
    UPLOAD_DIR: uploadDir,
    SEED_DEMO: 'true',
    JWT_SECRET: 'focusflow-e2e-secret',
    NODE_ENV: 'test'
  }
});

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  setTimeout(() => child.kill('SIGKILL'), 3_000).unref();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
child.on('exit', code => process.exit(code ?? 0));
