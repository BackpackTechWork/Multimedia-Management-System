const { db } = require('../config/db');
const { users, userStorageStats } = require('../models/schema');
const { eq, ne } = require('drizzle-orm');

class UserRepository {
  async findByEmail(email) {
    const results = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return results[0] || null;
  }

  async findById(id) {
    const results = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return results[0] || null;
  }

  async createUser(name, email, passwordHash, role = 'user') {
    return await db.transaction(async (tx) => {
      const result = await tx.insert(users).values({
        name,
        email,
        passwordHash,
        role
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

  async listUsers() {
    return await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt
    }).from(users);
  }

  async listShareCandidates(currentUserId) {
    return await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role
    }).from(users).where(ne(users.id, currentUserId));
  }

  async deleteUser(id) {
    await db.delete(users).where(eq(users.id, id));
  }

  async updateUser(id, { name, email, role, passwordHash }) {
    const values = {
      name,
      email,
      role
    };

    if (passwordHash) {
      values.passwordHash = passwordHash;
    }

    await db.update(users).set(values).where(eq(users.id, id));
  }

  async updateRole(id, role) {
    await db.update(users).set({ role }).where(eq(users.id, id));
  }

  async countNonAdminUsers() {
    const rows = await db.select().from(users).where(ne(users.role, 'super_admin'));
    return rows.length;
  }
}

module.exports = new UserRepository();
