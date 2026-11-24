export type Locale = "en" | "es";

export const MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    "nav.group.operations": "Operations",
    "nav.group.automation": "Automation & Data",
    "nav.group.messaging": "Messaging",
    "nav.group.governance": "Governance",
    "nav.overview": "Overview",
    "nav.chat": "Chat",
    "nav.machines": "Machines",
    "nav.dashboards": "Dashboards",
    "nav.workflows": "Workflows",
    "nav.connectors": "Connectors",
    "nav.monitoring": "Monitoring",
    "nav.queues": "Queues",
    "nav.notifications": "Notifications",
    "nav.admin": "Admin",
    "nav.license": "License",
    "chat.placeholder": "Ask about alarms, manuals, work orders, spare parts, or metrics...",
    "chat.send": "Send",
    "chat.whatIChecked": "What I checked",
    "chat.sources": "Cited Sources",
    "chat.turnIntoDashboard": "Turn into dashboard",
    "chat.photoSoon": "Photo (Coming soon)",
    "chat.voiceSoon": "Voice (Coming soon)",
    "machine.explainAlarm": "Explain active alarm",
    "machine.lastRepairs": "Last 3 repairs",
    "machine.partsForFault": "Parts for this fault",
    "dashboard.readOnly": "Read-only viewer",
    "dashboard.saveVersion": "Save Version",
    "admin.title": "Kojo Admin Console"
  },
  es: {
    "nav.group.operations": "Operaciones",
    "nav.group.automation": "Automatización y Datos",
    "nav.group.messaging": "Mensajería",
    "nav.group.governance": "Gobernanza",
    "nav.overview": "Resumen",
    "nav.chat": "Chat",
    "nav.machines": "Máquinas",
    "nav.dashboards": "Tableros",
    "nav.workflows": "Flujos",
    "nav.connectors": "Conectores",
    "nav.monitoring": "Monitoreo",
    "nav.queues": "Colas",
    "nav.notifications": "Notificaciones",
    "nav.admin": "Admin",
    "nav.license": "Licencia",
    "chat.placeholder": "Pregunta sobre alarmas, manuales, órdenes de trabajo, repuestos o métricas...",
    "chat.send": "Enviar",
    "chat.whatIChecked": "Qué revisé",
    "chat.sources": "Fuentes citadas",
    "chat.turnIntoDashboard": "Crear tablero",
    "chat.photoSoon": "Foto (Pronto)",
    "chat.voiceSoon": "Voz (Pronto)",
    "machine.explainAlarm": "Explicar alarma activa",
    "machine.lastRepairs": "Últimas 3 reparaciones",
    "machine.partsForFault": "Repuestos para esta falla",
    "dashboard.readOnly": "Vista de solo lectura",
    "dashboard.saveVersion": "Guardar versión",
    "admin.title": "Consola de Administración Kojo"
  }
};

export function translate(locale: Locale, key: string): string {
  return MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key;
}
