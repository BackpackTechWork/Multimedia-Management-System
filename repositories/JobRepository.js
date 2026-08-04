const { db, pool } = require('../config/db');
const { jobs } = require('../models/schema');
const { eq } = require('drizzle-orm');

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
    // Claim optimistically in autocommit mode. A conditional UPDATE guarantees
    // that only one worker wins each job without holding SELECT/range locks
    // across statements (the previous transaction could deadlock on status_idx).
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const [candidates] = await pool.query(
          "SELECT id FROM jobs WHERE status = 'pending' ORDER BY created_at, id LIMIT 16"
        );
        if (candidates.length === 0) return null;

        for (const candidate of candidates) {
          const [claim] = await pool.query(
            "UPDATE jobs SET status = 'running' WHERE id = ? AND status = 'pending'",
            [candidate.id]
          );
          if (claim.affectedRows !== 1) continue;

          const [results] = await pool.query("SELECT * FROM jobs WHERE id = ? LIMIT 1", [candidate.id]);
          const job = results[0];
          if (!job) return null;
          job.status = 'running';
          job.createdAt = job.created_at;
          job.payload = JSON.parse(job.payload);
          return job;
        }
      } catch (err) {
        const retryable = err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT';
        if (!retryable || attempt === 3) throw err;
        await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1) + Math.floor(Math.random() * 25)));
      }
    }
    return null;
  }

  async recoverInterruptedJobs() {
    await db.update(jobs)
      .set({ status: 'pending' })
      .where(eq(jobs.status, 'running'));
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
