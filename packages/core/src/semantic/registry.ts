import type { SemanticDimension } from "../dashboard/schema";

export interface MetricDefinition {
  id: string;
  label: string;
  unit: string;
  description: string;
  aggregation: "avg" | "sum" | "ratio" | "count";
  allowedDimensions: SemanticDimension[];
  allowedFilters: Array<"plantId" | "lineId" | "machineId" | "shift">;
  targetDefault?: number;
}

export const METRIC_REGISTRY: Record<string, MetricDefinition> = {
  oee: {
    id: "oee",
    label: "Overall Equipment Effectiveness (OEE)",
    unit: "%",
    description: "Availability × Performance × Quality across production runs",
    aggregation: "ratio",
    allowedDimensions: ["machine", "line", "plant", "shift", "day", "week"],
    allowedFilters: ["plantId", "lineId", "machineId", "shift"],
    targetDefault: 82
  },
  availability: {
    id: "availability",
    label: "Availability",
    unit: "%",
    description: "Run time as a percentage of planned production time",
    aggregation: "ratio",
    allowedDimensions: ["machine", "line", "plant", "shift", "day", "week"],
    allowedFilters: ["plantId", "lineId", "machineId", "shift"],
    targetDefault: 90
  },
  performance: {
    id: "performance",
    label: "Performance Efficiency",
    unit: "%",
    description: "Actual output rate relative to ideal cycle time",
    aggregation: "ratio",
    allowedDimensions: ["machine", "line", "plant", "shift", "day", "week"],
    allowedFilters: ["plantId", "lineId", "machineId", "shift"],
    targetDefault: 94
  },
  quality: {
    id: "quality",
    label: "First-Pass Quality Yield",
    unit: "%",
    description: "Good units as a percentage of total units produced",
    aggregation: "ratio",
    allowedDimensions: ["machine", "line", "plant", "shift", "day", "week"],
    allowedFilters: ["plantId", "lineId", "machineId", "shift"],
    targetDefault: 98
  },
  downtime_minutes: {
    id: "downtime_minutes",
    label: "Downtime Duration",
    unit: "min",
    description: "Total recorded equipment downtime minutes",
    aggregation: "sum",
    allowedDimensions: ["machine", "line", "plant", "day", "week", "reason_code"],
    allowedFilters: ["plantId", "lineId", "machineId"],
    targetDefault: 120
  },
  scrap_rate: {
    id: "scrap_rate",
    label: "Scrap Rate",
    unit: "%",
    description: "Scrapped units as a percentage of total units produced",
    aggregation: "ratio",
    allowedDimensions: ["machine", "line", "plant", "shift", "day", "week", "defect_type"],
    allowedFilters: ["plantId", "lineId", "machineId", "shift"],
    targetDefault: 2.0
  },
  throughput: {
    id: "throughput",
    label: "Good Unit Throughput",
    unit: "units",
    description: "Total good units produced",
    aggregation: "sum",
    allowedDimensions: ["machine", "line", "plant", "shift", "day", "week"],
    allowedFilters: ["plantId", "lineId", "machineId", "shift"]
  },
  mtbf: {
    id: "mtbf",
    label: "Mean Time Between Failures (MTBF)",
    unit: "hrs",
    description: "Average operating hours between unplanned failures",
    aggregation: "avg",
    allowedDimensions: ["machine", "line", "plant", "day", "week"],
    allowedFilters: ["plantId", "lineId", "machineId"],
    targetDefault: 168
  },
  mttr: {
    id: "mttr",
    label: "Mean Time To Repair (MTTR)",
    unit: "hrs",
    description: "Average hours from corrective work order open to close",
    aggregation: "avg",
    allowedDimensions: ["machine", "line", "plant", "day", "week"],
    allowedFilters: ["plantId", "lineId", "machineId"],
    targetDefault: 3.5
  },
  energy_kwh: {
    id: "energy_kwh",
    label: "Energy Consumption",
    unit: "kWh",
    description: "Total electrical energy consumed by equipment",
    aggregation: "sum",
    allowedDimensions: ["machine", "line", "plant", "day", "week"],
    allowedFilters: ["plantId", "lineId", "machineId"]
  },
  open_work_orders: {
    id: "open_work_orders",
    label: "Open Work Orders",
    unit: "orders",
    description: "Count of open and in-progress maintenance work orders",
    aggregation: "count",
    allowedDimensions: ["machine", "line", "plant", "day", "week"],
    allowedFilters: ["plantId", "lineId", "machineId"]
  },
  parts_below_min_stock: {
    id: "parts_below_min_stock",
    label: "Parts Below Min Stock",
    unit: "SKUs",
    description: "Spare parts where available stock (on hand minus reserved) is below minimum",
    aggregation: "count",
    allowedDimensions: ["plant"],
    allowedFilters: ["plantId"]
  }
};

export function listMetrics(): MetricDefinition[] {
  return Object.values(METRIC_REGISTRY);
}
