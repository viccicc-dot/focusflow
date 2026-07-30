import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve(process.cwd(), 'data', 'focusflow-e2e.db');
const uploadDir = path.resolve(process.cwd(), 'uploads-e2e');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
for (const file of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) fs.rmSync(file, { force: true });
fs.rmSync(uploadDir, { recursive: true, force: true });
console.log(`E2E state reset: ${databasePath}`);
