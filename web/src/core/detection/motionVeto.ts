/**
 * IMU-based motion-artifact veto (optional, configurable) — port of
 * detection/motion_veto.py.
 */

export class MotionVetoMonitor {
  private readonly maxLen: number;
  private readonly energyThresholdG2: number;
  private buf: Array<[number, number, number]> = [];

  constructor(fsHz: number, windowS = 0.5, energyThresholdG2 = 0.05) {
    this.maxLen = Math.max(Math.floor(windowS * fsHz), 2);
    this.energyThresholdG2 = energyThresholdG2;
  }

  /** Feed one IMU sample. Returns the current motion-energy estimate
   * (variance of deviation from 1g, in g^2). */
  update(accelX: number | null | undefined, accelY: number | null | undefined, accelZ: number | null | undefined): number {
    if (accelX == null || accelY == null || accelZ == null) return 0;

    this.buf.push([accelX, accelY, accelZ]);
    if (this.buf.length > this.maxLen) this.buf.shift();
    if (this.buf.length < 2) return 0;

    const deviations = this.buf.map(([x, y, z]) => Math.sqrt(x * x + y * y + z * z) - 1.0);
    const m = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    let sumSq = 0;
    for (const d of deviations) sumSq += (d - m) ** 2;
    return sumSq / deviations.length;
  }

  isMotionArtifact(motionEnergyG2: number): boolean {
    return motionEnergyG2 > this.energyThresholdG2;
  }
}
