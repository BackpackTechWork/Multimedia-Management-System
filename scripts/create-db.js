const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const dbName = process.env.DB_NAME || 'drive_clone';
  console.log(`Connecting to MySQL to check database "${dbName}"...`);
  
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  console.log(`Database "${dbName}" checked/created successfully.`);
  await connection.end();
}

main().catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
