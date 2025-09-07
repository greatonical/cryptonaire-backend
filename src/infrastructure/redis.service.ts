import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL not set");
    const tls = url.startsWith("rediss://") ? {} : undefined;
    this.client = new Redis(url, {
      tls,
      lazyConnect: false,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }

  onModuleDestroy() {
    if (this.client) this.client.quit().catch(() => void 0);
  }

  get raw() {
    return this.client;
  }

  // Attempt tokens
  async setAttemptToken(
    token: string,
    data: { userId: string; attemptId: string },
    ttlSec = 30
  ) {
    await this.client.setex(`attempt:${token}`, ttlSec, JSON.stringify(data));
  }
  async getAttemptToken(
    token: string
  ): Promise<{ userId: string; attemptId: string } | null> {
    const s = await this.client.get(`attempt:${token}`);
    return s ? JSON.parse(s) : null;
  }
  async delAttemptToken(token: string) {
    await this.client.del(`attempt:${token}`);
  }

  // Daily quota (seconds used), bucketed by YYYYMMDD
  async incrDailySeconds(userId: string, sec: number) {
    const key = this.dailyKey(userId);
    const v = await this.client.incrby(key, Math.max(0, Math.floor(sec)));
    // Set TTL to end of day if key is new
    const ttl = await this.client.ttl(key);
    if (ttl < 0) {
      const msToEnd = this.msUntilEndOfDay();
      await this.client.pexpire(key, msToEnd);
    }
    return v;
  }
  async getDailySeconds(userId: string): Promise<number> {
    const s = await this.client.get(this.dailyKey(userId));
    return s ? Number(s) : 0;
  }

  private dailyKey(userId: string) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `quota:${yyyy}${mm}${dd}:${userId}`;
  }
  private msUntilEndOfDay() {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return end.getTime() - now.getTime();
  }
}
