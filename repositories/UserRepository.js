const { db } = require('../config/db');
const { users, userStorageStats } = require('../models/schema');
const { eq } = require('drizzle-orm');

class UserRepository {
  async findByEmail(email) {
    const results = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return results[0] || null;
  }

  async findById(id) {
    const results = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return results[0] || null;
  }

  async createUser(name, email, passwordHash) {
    return await db.transaction(async (tx) => {
      const result = await tx.insert(users).values({
        name,
        email,
        passwordHash
      });
      const userId = result[0].insertId;
      
      await tx.insert(userStorageStats).values({
        userId,
        totalFiles: 0,
        totalFolders: 0,
        totalSize: 0
      });
      
      return userId;
    });
  }
}

module.exports = new UserRepository();
