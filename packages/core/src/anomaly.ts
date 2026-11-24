/**
 * Out-of-scope v1 interface seam for future predictive-maintenance anomaly detectors.
 * Implementations can consume TimeSeriesStore buckets and emit machine health scores.
 */
export interface AnomalyDetectionInput {
  tenantId: string;
  machineId: string;
  tag: string;
  recentValues: Array<{ ts: string; value: number }>;
}

export interface AnomalyScore {
  machineId: string;
  tag: string;
  isAnomaly: boolean;
  score: number; // 0..1
  explanation: string;
}

export interface AnomalyDetector {
  readonly id: string;
  detect(input: AnomalyDetectionInput): Promise<AnomalyScore>;
}
