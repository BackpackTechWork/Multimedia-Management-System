const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const userRepository = require('../repositories/UserRepository');

const DEFAULT_ADMIN_EMAIL = 'admin@admin.com';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

class AdminSeedService {
  async ensureUserRoleColumn() {
    const [columns] = await pool.query("SHOW COLUMNS FROM users LIKE 'role'");
    if (columns.length === 0) {
      await pool.query("ALTER TABLE users ADD COLUMN role varchar(50) NOT NULL DEFAULT 'user' AFTER password_hash");
      console.log("Applied users.role column for role-based access.");
    }
  }

  async ensureSuperAdmin() {
    await this.ensureUserRoleColumn();
    await this.ensureSharingSchema();

    const email = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
    const existingUser = await userRepository.findByEmail(email);

    if (existingUser) {
      if (existingUser.role !== 'super_admin') {
        await userRepository.updateRole(existingUser.id, 'super_admin');
        console.log(`Promoted ${email} to super admin.`);
      }
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await userRepository.createUser('Super Admin', email, passwordHash, 'super_admin');
    console.log(`Seeded super admin account: ${email}`);
  }

  async ensureSharingSchema() {
    const [createdByColumns] = await pool.query("SHOW COLUMNS FROM shares LIKE 'created_by_id'");
    if (createdByColumns.length === 0) {
      await pool.query("ALTER TABLE shares ADD COLUMN created_by_id int");
      await pool.query("CREATE INDEX share_created_by_idx ON shares (created_by_id)");
      console.log("Applied shares.created_by_id column for user sharing.");
    }

    const [linkAccessColumns] = await pool.query("SHOW COLUMNS FROM shares LIKE 'link_access'");
    if (linkAccessColumns.length === 0) {
      await pool.query("ALTER TABLE shares ADD COLUMN link_access varchar(20) NOT NULL DEFAULT 'anyone' AFTER allow_download");
      console.log("Applied shares.link_access column for link sharing.");
    }

    const [linkRoleColumns] = await pool.query("SHOW COLUMNS FROM shares LIKE 'link_role'");
    if (linkRoleColumns.length === 0) {
      await pool.query("ALTER TABLE shares ADD COLUMN link_role varchar(20) NOT NULL DEFAULT 'viewer' AFTER link_access");
      console.log("Applied shares.link_role column for link permissions.");
    }

    const [recipientTables] = await pool.query("SHOW TABLES LIKE 'share_recipients'");
    if (recipientTables.length === 0) {
      await pool.query(`
        CREATE TABLE share_recipients (
          id int AUTO_INCREMENT NOT NULL,
          share_id int NOT NULL,
          user_id int NOT NULL,
          created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT share_recipients_id PRIMARY KEY(id),
          CONSTRAINT share_recipients_share_user_idx UNIQUE(share_id, user_id)
        )
      `);
      await pool.query("CREATE INDEX share_recipients_share_id_idx ON share_recipients (share_id)");
      await pool.query("CREATE INDEX share_recipients_user_id_idx ON share_recipients (user_id)");
      console.log("Applied share_recipients table for user sharing.");
    }
  }
}

module.exports = new AdminSeedService();
