const { db } = require('../config/db');
const { users, userStorageStats } = require('../models/schema');
const { eq, ne } = require('drizzle-orm');

class UserRepository {
  async resolveUmsUser(identity, passwordHash) {
    try {
      return await db.transaction(async tx => {
        const [linked] = await tx.select().from(users)
          .where(eq(users.umsUserId, identity.id)).limit(1);
        if (linked) return linked;

        const [existing] = await tx.select().from(users)
          .where(eq(users.email, identity.email)).limit(1).for('update');
        if (existing) {
          if (existing.umsUserId && existing.umsUserId !== identity.id) {
            throw new Error('This MMS account is already linked to another UMS identity.');
          }
          await tx.update(users).set({ umsUserId: identity.id }).where(eq(users.id, existing.id));
          return { ...existing, umsUserId: identity.id };
        }

        const [result] = await tx.insert(users).values({ name: identity.name,
          email: identity.email, umsUserId: identity.id, passwordHash, role: 'user' });
        await tx.insert(userStorageStats).values({ userId: result.insertId,
          totalFiles: 0, totalFolders: 0, totalSize: 0 });
        return { id: result.insertId, name: identity.name, email: identity.email,
          umsUserId: identity.id, role: 'user' };
      });
    } catch (error) {
      // A concurrent callback may already have linked/created this identity.
      if (error.code === 'ER_DUP_ENTRY' || error.code === 'ER_LOCK_DEADLOCK') {
        const [linked] = await db.select().from(users)
          .where(eq(users.umsUserId, identity.id)).limit(1);
        if (linked) return linked;
      }
      throw error;
    }
  }

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
