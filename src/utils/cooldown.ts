export class Cooldown {
  private readonly cooldowns = new Map<string, number>();
  private readonly duration: number;

  constructor(time: number) {
    this.duration = time * 1_000;
  }

  check(userId: string) {
    const now = Date.now();
    const userCooldown = this.cooldowns.get(userId);

    if (!userCooldown) return false;

    if (now < userCooldown) return true;

    this.cooldowns.delete(userId);
    return false;
  }

  set(userId: string) {
    const expiresAt = Date.now() + this.duration;
    this.cooldowns.set(userId, expiresAt);

    setTimeout(() => this.cooldowns.delete(userId), this.duration);
  }

  getRemainingTime(userId: string) {
    const userCooldown = this.cooldowns.get(userId);

    if (!userCooldown) return 0;

    const remaining = userCooldown - Date.now();

    return Math.max(0, Math.ceil(remaining / 1000));
  }

  reset(userid: string) {
    this.cooldowns.delete(userid);
  }
}
