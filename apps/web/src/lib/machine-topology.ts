export type MachineCategoryId =
  | "machining"
  | "stamping"
  | "molding"
  | "filling"
  | "packaging"
  | "robotics"
  | "conveyor"
  | "utility";

export type ConnectionCategoryId =
  | "material_flow"
  | "pneumatic_utility"
  | "robotic_handling"
  | "safety_interlock"
  | "shared_spares_sop";

export interface CategoryMeta<T extends string> {
  id: T;
  label: string;
  shortLabel: string;
  color: string;
  badgeClass: string;
  tintClass: string;
  stageOrder: number;
}

export const MACHINE_CATEGORIES: Record<MachineCategoryId, CategoryMeta<MachineCategoryId>> = {
  utility: {
    id: "utility",
    label: "Utilities & Pneumatics",
    shortLabel: "Utility",
    color: "#db2777",
    badgeClass:
      "border-pink-300 bg-pink-50 text-pink-900 dark:border-pink-800/70 dark:bg-pink-950/60 dark:text-pink-200",
    tintClass: "bg-pink-500/10",
    stageOrder: 0
  },
  conveyor: {
    id: "conveyor",
    label: "Material Handling",
    shortLabel: "Conveyor",
    color: "#ca8a04",
    badgeClass:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200",
    tintClass: "bg-amber-500/10",
    stageOrder: 1
  },
  robotics: {
    id: "robotics",
    label: "Robotics & Cell",
    shortLabel: "Robotics",
    color: "#ea580c",
    badgeClass:
      "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800/70 dark:bg-orange-950/60 dark:text-orange-200",
    tintClass: "bg-orange-500/10",
    stageOrder: 1
  },
  machining: {
    id: "machining",
    label: "CNC Machining",
    shortLabel: "CNC",
    color: "#0284c7",
    badgeClass:
      "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200",
    tintClass: "bg-sky-500/10",
    stageOrder: 2
  },
  molding: {
    id: "molding",
    label: "Injection Molding",
    shortLabel: "Molding",
    color: "#9333ea",
    badgeClass:
      "border-purple-300 bg-purple-50 text-purple-900 dark:border-purple-800/70 dark:bg-purple-950/60 dark:text-purple-200",
    tintClass: "bg-purple-500/10",
    stageOrder: 2
  },
  filling: {
    id: "filling",
    label: "Filling & Dosing",
    shortLabel: "Filler",
    color: "#0d9488",
    badgeClass:
      "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200",
    tintClass: "bg-teal-500/10",
    stageOrder: 2
  },
  stamping: {
    id: "stamping",
    label: "Forming & Stamping",
    shortLabel: "Press",
    color: "#4f46e5",
    badgeClass:
      "border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800/70 dark:bg-indigo-950/60 dark:text-indigo-200",
    tintClass: "bg-indigo-500/10",
    stageOrder: 3
  },
  packaging: {
    id: "packaging",
    label: "Packaging & End-of-Line",
    shortLabel: "Packaging",
    color: "#059669",
    badgeClass:
      "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200",
    tintClass: "bg-emerald-500/10",
    stageOrder: 3
  }
};

export interface ConnectionCategoryMeta {
  id: ConnectionCategoryId;
  label: string;
  color: string;
  dashed: boolean;
  badgeClass: string;
}

export const CONNECTION_CATEGORIES: Record<ConnectionCategoryId, ConnectionCategoryMeta> = {
  material_flow: {
    id: "material_flow",
    label: "Material Flow",
    color: "#0d9488",
    dashed: false,
    badgeClass:
      "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200"
  },
  pneumatic_utility: {
    id: "pneumatic_utility",
    label: "Pneumatic / Utility",
    color: "#0284c7",
    dashed: true,
    badgeClass:
      "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200"
  },
  robotic_handling: {
    id: "robotic_handling",
    label: "Robotic Handling",
    color: "#ea580c",
    dashed: false,
    badgeClass:
      "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800/70 dark:bg-orange-950/60 dark:text-orange-200"
  },
  safety_interlock: {
    id: "safety_interlock",
    label: "Safety Interlock",
    color: "#7c3aed",
    dashed: true,
    badgeClass:
      "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800/70 dark:bg-violet-950/60 dark:text-violet-200"
  },
  shared_spares_sop: {
    id: "shared_spares_sop",
    label: "Shared SOP / Spares",
    color: "#ca8a04",
    dashed: true,
    badgeClass:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200"
  }
};

export function getMachineCategoryMeta(machineType: string): CategoryMeta<MachineCategoryId> {
  switch (machineType.toLowerCase()) {
    case "cnc":
      return MACHINE_CATEGORIES.machining;
    case "press":
      return MACHINE_CATEGORIES.stamping;
    case "injection_molder":
      return MACHINE_CATEGORIES.molding;
    case "filler":
      return MACHINE_CATEGORIES.filling;
    case "packaging_line":
      return MACHINE_CATEGORIES.packaging;
    case "robot_cell":
      return MACHINE_CATEGORIES.robotics;
    case "conveyor":
      return MACHINE_CATEGORIES.conveyor;
    case "compressor":
    default:
      return MACHINE_CATEGORIES.utility;
  }
}

export function getConnectionCategoryMeta(category: string): ConnectionCategoryMeta {
  if (category in CONNECTION_CATEGORIES) {
    return CONNECTION_CATEGORIES[category as ConnectionCategoryId];
  }
  return CONNECTION_CATEGORIES.material_flow;
}

export interface TopologyDocumentRef {
  documentId: string;
  chunkId?: string;
  title: string;
  revision: string;
  type: string;
  source: string;
  page: number;
  sectionPath: string;
  excerpt: string;
}

export interface TopologyNode {
  id: string;
  name: string;
  plantId: string;
  lineId: string | null;
  machineType: string;
  category: MachineCategoryId;
  categoryLabel: string;
  categoryColor: string;
  manufacturer: string;
  model: string;
  status: string;
  position: { x: number; y: number };
  documents: TopologyDocumentRef[];
}

export interface TopologyEdge {
  id: string;
  sourceId: string;
  targetId: string;
  category: ConnectionCategoryId;
  categoryLabel: string;
  categoryColor: string;
  label: string;
  spec: string;
  crossLine: boolean;
  citations: TopologyDocumentRef[];
}

export interface TopologyZone {
  id: string;
  plantId: string;
  plantName: string;
  lineId: string;
  lineName: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  machineCount: number;
}

export interface MachineTopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  zones: TopologyZone[];
  documentsIndexed: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface CustomSavedConnection {
  id?: string;
  sourceId: string;
  targetId: string;
  category: ConnectionCategoryId;
  label: string;
  spec?: string;
  updatedAt?: string;
}

interface InputMachine {
  id: string;
  name: string;
  plantId: string;
  lineId?: string | null;
  machineType: string;
  manufacturer: string;
  model: string;
  status: string | null;
  metadata?: Record<string, unknown> | null;
}

interface InputLine {
  id: string;
  name: string;
  plantId: string;
}

interface InputPlant {
  id: string;
  name: string;
  code?: string;
}

interface InputDocument {
  id: string;
  title: string;
  type: string;
  machineTypes: string[];
  revision: string;
  status: string;
  source: string;
  rawContent?: string;
}

interface InputChunk {
  id: string;
  documentId: string;
  page: number;
  sectionPath: string;
  text: string;
}

const ZONE_PALETTE = ["#0284c7", "#9333ea", "#0d9488", "#4f46e5", "#ea580c", "#059669"];

function normalizeConnCategory(raw: string): ConnectionCategoryId {
  const clean = raw.trim().toLowerCase();
  if (clean in CONNECTION_CATEGORIES) return clean as ConnectionCategoryId;
  if (/pneum|air|bar|utility|coolant|chiller|power/.test(clean)) return "pneumatic_utility";
  if (/robot|pick|load|pallet|tend/.test(clean)) return "robotic_handling";
  if (/safe|loto|interlock|curtain|gate|e-?stop/.test(clean)) return "safety_interlock";
  if (/spare|sop|shared|failover|parallel|backup/.test(clean)) return "shared_spares_sop";
  return "material_flow";
}

function addCitation(list: TopologyDocumentRef[], next: TopologyDocumentRef) {
  if (!list.some((c) => c.documentId === next.documentId && c.page === next.page && c.excerpt === next.excerpt)) {
    list.push(next);
  }
}

export function buildDocumentGroundedTopology(params: {
  machines: InputMachine[];
  lines: InputLine[];
  plants: InputPlant[];
  documents: InputDocument[];
  chunks: InputChunk[];
}): MachineTopologyGraph {
  const currentDocs = params.documents.filter((d) => d.status === "current");
  const docById = new Map(currentDocs.map((d) => [d.id, d]));
  const plantById = new Map(params.plants.map((p) => [p.id, p]));
  const lineById = new Map(params.lines.map((l) => [l.id, l]));
  const machineById = new Map(params.machines.map((m) => [m.id, m]));
  const machineByLowerId = new Map(params.machines.map((m) => [m.id.toLowerCase(), m]));
  const machineByLowerName = new Map(params.machines.map((m) => [m.name.toLowerCase(), m]));

  const resolveMachine = (token: string): InputMachine | undefined => {
    const clean = token.trim().replace(/^`|`$/g, "");
    return machineByLowerId.get(clean.toLowerCase()) ?? machineByLowerName.get(clean.toLowerCase());
  };

  // Build ordered line swimlanes with left-to-right stage columns and wide routing channels
  const byLine = new Map<string, InputMachine[]>();
  for (const m of params.machines) {
    const key = m.lineId || `${m.plantId}::unassigned`;
    const list = byLine.get(key) ?? [];
    list.push(m);
    byLine.set(key, list);
  }

  const orderedLineKeys = Array.from(byLine.keys()).sort((a, b) => a.localeCompare(b));
  const zones: TopologyZone[] = [];
  const positions = new Map<string, { x: number; y: number }>();

  const ZONE_MARGIN_X = 24;
  const ZONE_PAD_X = 36;
  const ZONE_HEADER_H = 52;
  const ZONE_PAD_BOTTOM = 28;
  const NODE_W = 204;
  const NODE_H = 88;
  const COL_GAP_X = 140;
  const ROW_GAP_Y = 36;
  const ZONE_GAP_Y = 44;
  const MAX_ROWS_PER_COL = 3;

  let cursorY = 20;
  let maxCanvasWidth = 960;

  orderedLineKeys.forEach((lineKey, zoneIdx) => {
    const lineMachines = (byLine.get(lineKey) ?? []).slice().sort((a, b) => {
      const sa = getMachineCategoryMeta(a.machineType).stageOrder;
      const sb = getMachineCategoryMeta(b.machineType).stageOrder;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });

    const stageGroups = new Map<number, InputMachine[]>();
    for (const m of lineMachines) {
      const st = getMachineCategoryMeta(m.machineType).stageOrder;
      const list = stageGroups.get(st) ?? [];
      list.push(m);
      stageGroups.set(st, list);
    }

    const columns: InputMachine[][] = [];
    const sortedStages = Array.from(stageGroups.keys()).sort((a, b) => a - b);
    for (const st of sortedStages) {
      const group = stageGroups.get(st) ?? [];
      for (let i = 0; i < group.length; i += MAX_ROWS_PER_COL) {
        columns.push(group.slice(i, i + MAX_ROWS_PER_COL));
      }
    }

    const maxRows = Math.max(1, ...columns.map((c) => c.length));
    const colsUsed = Math.max(1, columns.length);
    const innerH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP_Y;
    const zoneW = Math.max(680, ZONE_PAD_X * 2 + colsUsed * NODE_W + Math.max(0, colsUsed - 1) * COL_GAP_X);
    const zoneH = ZONE_HEADER_H + innerH + ZONE_PAD_BOTTOM;

    columns.forEach((colMachines, colIdx) => {
      const colH = colMachines.length * NODE_H + (colMachines.length - 1) * ROW_GAP_Y;
      const yOffset = Math.round((innerH - colH) / 2);
      colMachines.forEach((m, rowIdx) => {
        positions.set(m.id, {
          x: ZONE_MARGIN_X + ZONE_PAD_X + colIdx * (NODE_W + COL_GAP_X),
          y: cursorY + ZONE_HEADER_H + yOffset + rowIdx * (NODE_H + ROW_GAP_Y)
        });
      });
    });

    const first = lineMachines[0]!;
    const lineMeta = lineById.get(lineKey);
    const plantMeta = plantById.get(first.plantId);

    zones.push({
      id: lineKey,
      plantId: first.plantId,
      plantName: plantMeta?.name ?? first.plantId,
      lineId: lineKey,
      lineName: lineMeta?.name ?? `${plantMeta?.code ?? first.plantId} Equipment Group`,
      color: ZONE_PALETTE[zoneIdx % ZONE_PALETTE.length]!,
      x: ZONE_MARGIN_X,
      y: cursorY,
      width: zoneW,
      height: zoneH,
      machineCount: lineMachines.length
    });

    maxCanvasWidth = Math.max(maxCanvasWidth, ZONE_MARGIN_X * 2 + zoneW);
    cursorY += zoneH + ZONE_GAP_Y;
  });

  // Extract document-grounded edges from chunks (and fallback rawContent if a doc has no chunks yet)
  const edgeMap = new Map<string, TopologyEdge>();
  const textSources: Array<{
    document: InputDocument;
    chunkId?: string;
    page: number;
    sectionPath: string;
    text: string;
  }> = [];

  const chunkedDocIds = new Set<string>();
  for (const ch of params.chunks) {
    const doc = docById.get(ch.documentId);
    if (!doc) continue;
    chunkedDocIds.add(doc.id);
    textSources.push({
      document: doc,
      chunkId: ch.id,
      page: ch.page,
      sectionPath: ch.sectionPath,
      text: ch.text
    });
  }
  for (const doc of currentDocs) {
    if (!chunkedDocIds.has(doc.id) && doc.rawContent) {
      textSources.push({
        document: doc,
        page: 1,
        sectionPath: "Drawing Specification",
        text: doc.rawContent
      });
    }
  }

  const upsertEdge = (
    srcId: string,
    tgtId: string,
    catRaw: string,
    label: string,
    spec: string,
    citation?: TopologyDocumentRef
  ) => {
    const src = machineById.get(srcId);
    const tgt = machineById.get(tgtId);
    if (!src || !tgt || src.id === tgt.id) return;
    const category = normalizeConnCategory(catRaw);
    const meta = getConnectionCategoryMeta(category);
    const edgeKey = `${src.id}::${tgt.id}::${category}`;
    const existing = edgeMap.get(edgeKey);
    if (existing) {
      if (citation) addCitation(existing.citations, citation);
      return;
    }
    edgeMap.set(edgeKey, {
      id: `edge-${src.id}-${tgt.id}-${category}`,
      sourceId: src.id,
      targetId: tgt.id,
      category,
      categoryLabel: meta.label,
      categoryColor: meta.color,
      label: label.trim() || meta.label,
      spec: spec.trim() || `${src.name} connected to ${tgt.name}`,
      crossLine: (src.lineId ?? "") !== (tgt.lineId ?? ""),
      citations: citation ? [citation] : []
    });
  };

  const connDirectiveRe =
    /\[CONN:\s*([^|\]]+?)\s*->\s*([^|\]]+?)\s*\|\s*([^|\]]+?)\s*\|\s*([^|\]]+?)(?:\s*\|\s*([^\]]+?))?\s*\]/gi;
  const arrowProseRe =
    /\b(mach-[a-z0-9-]+)\s*(?:->|feeds|supplies|tends|transfers to|interlocked with)\s*(mach-[a-z0-9-]+)\b/gi;

  for (const srcEntry of textSources) {
    let match: RegExpExecArray | null;
    connDirectiveRe.lastIndex = 0;
    while ((match = connDirectiveRe.exec(srcEntry.text)) !== null) {
      const srcMachine = resolveMachine(match[1] ?? "");
      const tgtMachine = resolveMachine(match[2] ?? "");
      if (!srcMachine || !tgtMachine) continue;
      upsertEdge(
        srcMachine.id,
        tgtMachine.id,
        match[3] ?? "material_flow",
        match[4] ?? "Connected",
        match[5] ?? "",
        {
          documentId: srcEntry.document.id,
          chunkId: srcEntry.chunkId,
          title: srcEntry.document.title,
          revision: srcEntry.document.revision,
          type: srcEntry.document.type,
          source: srcEntry.document.source,
          page: srcEntry.page,
          sectionPath: srcEntry.sectionPath,
          excerpt: match[0]
        }
      );
    }

    const textWithoutDirectives = srcEntry.text.replace(connDirectiveRe, " ");
    arrowProseRe.lastIndex = 0;
    while ((match = arrowProseRe.exec(textWithoutDirectives)) !== null) {
      const srcMachine = resolveMachine(match[1] ?? "");
      const tgtMachine = resolveMachine(match[2] ?? "");
      if (!srcMachine || !tgtMachine) continue;
      const snippet = match[0];
      const inferredCat = /supply|supplies|air|coolant|pneum/i.test(snippet)
        ? "pneumatic_utility"
        : /interlock|safety/i.test(snippet)
          ? "safety_interlock"
          : /tends|robot/i.test(snippet)
            ? "robotic_handling"
            : "material_flow";
      upsertEdge(
        srcMachine.id,
        tgtMachine.id,
        inferredCat,
        getConnectionCategoryMeta(inferredCat).label,
        snippet,
        {
          documentId: srcEntry.document.id,
          chunkId: srcEntry.chunkId,
          title: srcEntry.document.title,
          revision: srcEntry.document.revision,
          type: srcEntry.document.type,
          source: srcEntry.document.source,
          page: srcEntry.page,
          sectionPath: srcEntry.sectionPath,
          excerpt: snippet
        }
      );
    }
  }

  // Merge custom saved connections stored on machine metadata (created via Floating AI Save)
  for (const m of params.machines) {
    const custom = Array.isArray(m.metadata?.customConnections)
      ? (m.metadata?.customConnections as CustomSavedConnection[])
      : [];
    for (const c of custom) {
      if (!c || typeof c.sourceId !== "string" || typeof c.targetId !== "string") continue;
      upsertEdge(
        c.sourceId,
        c.targetId,
        c.category ?? "material_flow",
        c.label ?? "Saved Connection",
        c.spec ?? "Saved topology update",
        {
          documentId: "ai-saved-topology",
          title: "Saved Topology Update",
          revision: c.updatedAt ? c.updatedAt.slice(0, 10) : "Saved",
          type: "kb",
          source: "Lutic AI Change Ledger",
          page: 1,
          sectionPath: "Machine Topology",
          excerpt: `${c.sourceId} -> ${c.targetId}: ${c.spec ?? c.label}`
        }
      );
    }
  }

  // Attach relevant manuals/SOPs/drawings per machine node
  const nodes: TopologyNode[] = params.machines.map((m) => {
    const cat = getMachineCategoryMeta(m.machineType);
    const docs: TopologyDocumentRef[] = [];
    for (const doc of currentDocs) {
      const mentionsId = Boolean(doc.rawContent?.includes(m.id));
      const matchesType = doc.machineTypes.includes(m.machineType);
      if (mentionsId || matchesType) {
        addCitation(docs, {
          documentId: doc.id,
          title: doc.title,
          revision: doc.revision,
          type: doc.type,
          source: doc.source,
          page: 1,
          sectionPath: mentionsId ? "Referenced on Drawing" : "Equipment Manual / SOP",
          excerpt: doc.source
        });
      }
    }
    return {
      id: m.id,
      name: m.name,
      plantId: m.plantId,
      lineId: m.lineId ?? null,
      machineType: m.machineType,
      category: cat.id,
      categoryLabel: cat.label,
      categoryColor: cat.color,
      manufacturer: m.manufacturer,
      model: m.model,
      status: m.status ?? "offline",
      position: positions.get(m.id) ?? { x: 48, y: 48 },
      documents: docs
    };
  });

  return {
    nodes,
    edges: Array.from(edgeMap.values()),
    zones,
    documentsIndexed: currentDocs.length,
    canvasWidth: maxCanvasWidth,
    canvasHeight: Math.max(420, cursorY + 12)
  };
}
