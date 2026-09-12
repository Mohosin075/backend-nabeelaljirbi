import Redis, { RedisOptions } from "ioredis";

/**
 * 🌍 REDIS UTC NOTE:
 * This Redis connection is used for BullMQ job queues that schedule appointments
 * and notifications. All jobs are scheduled using UTC timestamps.
 * 
 * Job delays are calculated from Date.now() (UTC epoch milliseconds).
 * Ensure all date calculations before adding jobs to queues use UTC methods.
 * 
 * For detailed standards, see docs/UTC_STANDARDS.md
 */
const redisOptions: RedisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null, 
};

export const redis = new Redis(redisOptions);
