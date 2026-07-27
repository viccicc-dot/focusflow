import { initDb } from './db.js';
import { createAccount } from './seed-data.js';
initDb();
await createAccount({ email: 'demo@focusflow.local', name: '演示用户', password: 'demo1234', demo: true });
console.log('Demo account ready: demo@focusflow.local / demo1234');
