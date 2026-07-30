import fs from 'node:fs';
import zlib from 'node:zlib';

const files = [
  ['scripts/payload-smart-table-ui.txt', 'client/src/SmartTable.jsx'],
  ['scripts/payload-smart-table-css.txt', 'client/src/smart-table.css'],
  ['scripts/payload-smart-table-server.txt', 'server/smart-tables.js'],
  ['scripts/payload-seed-data.txt', 'server/seed-data.js']
];

for (const [payloadPath, targetPath] of files) {
  const encoded = fs.readFileSync(payloadPath, 'utf8').trim();
  if (!encoded) throw new Error(`Empty payload: ${payloadPath}`);
  const decoded = zlib.gunzipSync(Buffer.from(encoded, 'base64'));
  fs.writeFileSync(targetPath, decoded);
  console.log(`Updated ${targetPath}`);
}
