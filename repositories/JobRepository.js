const { db } = require('../config/db');
const { jobs } = require('../models/schema');
const { eq, and, sql } = require('drizzle-orm');

class JobRepository {
  async createJob(type, payload) {
    const [result] = await db.insert(jobs).values({
      type,
      payload: JSON.stringify(payload),
      status: 'pending'
    });
    return result.insertId;
  }

  async getNextPendingJob() {
    return await db.transaction(async (tx) => {
      const results = await tx.select()
        .from(jobs)
        .where(eq(jobs.status, 'pending'))
        .orderBy(jobs.createdAt)
        .limit(1);
      
      const job = results[0] || null;
      if (job) {
        await tx.update(jobs)
          .set({ status: 'running' })
          .where(eq(jobs.id, job.id));
        
        job.status = 'running';
        job.payload = JSON.parse(job.payload);
      }
      return job;
    });
  }

  async updateJobStatus(id, status) {
    await db.update(jobs)
      .set({ status })
      .where(eq(jobs.id, id));
  }

  async getJobById(id) {
    const results = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    if (results[0]) {
      results[0].payload = JSON.parse(results[0].payload);
    }
    return results[0] || null;
  }
}

module.exports = new JobRepository();
