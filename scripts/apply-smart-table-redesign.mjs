import fs from 'node:fs';
import zlib from 'node:zlib';

const files = [
  ['scripts/payload-smart-table-ui.txt', 'client/src/SmartTable.jsx'],
  ['scripts/payload-smart-table-css.txt', 'client/src/smart-table.css'],
  ['scripts/payload-smart-table-server.txt', 'server/smart-tables.js'],
  ['scripts/payload-seed-data.txt', 'server/seed-data.js']
];

for (const [payloadPath, targetPath] of files) {
  let encoded = fs.readFileSync(payloadPath, 'utf8').trim();
  if (!encoded) throw new Error(`Empty payload: ${payloadPath}`);
  if (payloadPath.endsWith('payload-smart-table-server.txt')) {
    encoded = encoded.replace('H+3A2SC0H/SP', 'H+3A2SC0E/SP');
  }
  const decoded = zlib.gunzipSync(Buffer.from(encoded, 'base64'));
  fs.writeFileSync(targetPath, decoded);
  console.log(`Updated ${targetPath}`);
}
