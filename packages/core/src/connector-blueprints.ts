export const CONNECTOR_OAUTH_COOKIE = "lutic_connector_oauth";

export type ConnectorAuthScheme =
  | "oauth2"
  | "api_key"
  | "bearer"
  | "basic"
  | "remote_mcp"
  | "openapi"
  | "protocol";

export interface ConnectorAuthField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  defaultValue?: string;
}

export interface OAuthProviderConfig {
  authorizationUrl: string;
  tokenUrl: string;
  defaultScopes: string[];
  apiBaseUrl: string;
}

export interface ConnectorAuthBlueprint {
  slug: string;
  name: string;
  category: string;
  supportedSchemes: ConnectorAuthScheme[];
  defaultScheme: ConnectorAuthScheme;
  defaultEndpointUrl: string;
  oauthProvider?: OAuthProviderConfig;
  fieldsByScheme: Partial<Record<ConnectorAuthScheme, ConnectorAuthField[]>>;
  notes?: string;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  github: {
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    defaultScopes: ["repo", "read:user"],
    apiBaseUrl: "https://api.github.com"
  },
  slack: {
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    defaultScopes: ["channels:read", "chat:write", "users:read"],
    apiBaseUrl: "https://slack.com/api"
  },
  linear: {
    authorizationUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    defaultScopes: ["read", "write"],
    apiBaseUrl: "https://api.linear.app/graphql"
  },
  jira: {
    authorizationUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    defaultScopes: ["read:jira-work", "write:jira-work", "offline_access"],
    apiBaseUrl: "https://your-domain.atlassian.net"
  },
  notion: {
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    defaultScopes: [],
    apiBaseUrl: "https://api.notion.com/v1"
  },
  google: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: ["openid", "email", "profile"],
    apiBaseUrl: "https://www.googleapis.com"
  },
  gmail: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: ["https://www.googleapis.com/auth/gmail.modify"],
    apiBaseUrl: "https://gmail.googleapis.com/gmail/v1"
  },
  "google-drive": {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    apiBaseUrl: "https://www.googleapis.com/drive/v3"
  },
  "google-calendar": {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: ["https://www.googleapis.com/auth/calendar"],
    apiBaseUrl: "https://www.googleapis.com/calendar/v3"
  },
  "google-sheets": {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    apiBaseUrl: "https://sheets.googleapis.com/v4"
  },
  microsoft: {
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    defaultScopes: ["offline_access", "User.Read"],
    apiBaseUrl: "https://graph.microsoft.com/v1.0"
  },
  outlook: {
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    defaultScopes: ["offline_access", "Mail.ReadWrite"],
    apiBaseUrl: "https://graph.microsoft.com/v1.0"
  },
  teams: {
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    defaultScopes: ["offline_access", "ChannelMessage.Send"],
    apiBaseUrl: "https://graph.microsoft.com/v1.0"
  },
  discord: {
    authorizationUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    defaultScopes: ["identify", "guilds"],
    apiBaseUrl: "https://discord.com/api/v10"
  },
  hubspot: {
    authorizationUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    defaultScopes: ["crm.objects.contacts.read", "crm.objects.deals.read"],
    apiBaseUrl: "https://api.hubapi.com"
  },
  gitlab: {
    authorizationUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    defaultScopes: ["api", "read_user"],
    apiBaseUrl: "https://gitlab.com/api/v4"
  },
  asana: {
    authorizationUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token",
    defaultScopes: ["default"],
    apiBaseUrl: "https://app.asana.com/api/1.0"
  },
  figma: {
    authorizationUrl: "https://www.figma.com/oauth",
    tokenUrl: "https://api.figma.com/v1/oauth/token",
    defaultScopes: ["file_read"],
    apiBaseUrl: "https://api.figma.com/v1"
  },
  dropbox: {
    authorizationUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    defaultScopes: [],
    apiBaseUrl: "https://api.dropboxapi.com/2"
  },
  salesforce: {
    authorizationUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    defaultScopes: ["api", "refresh_token"],
    apiBaseUrl: "https://your-instance.my.salesforce.com"
  },
  zendesk: {
    authorizationUrl: "https://your-subdomain.zendesk.com/oauth/authorizations/new",
    tokenUrl: "https://your-subdomain.zendesk.com/oauth/tokens",
    defaultScopes: ["read", "write"],
    apiBaseUrl: "https://your-subdomain.zendesk.com/api/v2"
  },
  stripe: {
    authorizationUrl: "https://connect.stripe.com/oauth/authorize",
    tokenUrl: "https://connect.stripe.com/oauth/token",
    defaultScopes: ["read_write"],
    apiBaseUrl: "https://api.stripe.com/v1"
  }
};

const API_KEY_REST_URLS: Record<string, { url: string; headerName?: string }> = {
  servicenow: { url: "https://your-instance.service-now.com/api/now" },
  openai: { url: "https://api.openai.com/v1" },
  anthropic: { url: "https://api.anthropic.com/v1", headerName: "x-api-key" },
  "17track": { url: "https://api.17track.net/track/v2.2", headerName: "17token" },
  "sap-pm": { url: "https://s4hana.example.com/sap/opu/odata/sap/API_MAINTORDER" },
  "sap-mm": { url: "https://s4hana.example.com/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV" },
  "sap-pp": { url: "https://s4hana.example.com/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV" },
  "sap-qm": { url: "https://s4hana.example.com/sap/opu/odata/sap/API_INSPECTIONLOT_SRV" }
};

export const AUTH_SCHEME_LABELS: Record<ConnectorAuthScheme, string> = {
  oauth2: "OAuth 2.0",
  api_key: "API Key",
  bearer: "Bearer Token",
  basic: "Basic Auth",
  remote_mcp: "Remote MCP",
  openapi: "OpenAPI Spec",
  protocol: "Wire Protocol"
};

export function getConnectorAuthBlueprint(entry: {
  slug: string;
  name: string;
  category?: string;
  transport?: string;
  credentialFields?: Array<{ key: string; label: string; secret?: boolean; defaultValue?: string }>;
}): ConnectorAuthBlueprint {
  const slug = entry.slug.toLowerCase();
  const category = entry.category || "http";
  const catalogDefaultUrl =
    entry.credentialFields?.find((f) => f.key === "endpointUrl" || f.key === "endpoint")
      ?.defaultValue ?? "";

  if (entry.transport === "remote_mcp" || slug.endsWith("-mcp")) {
    const defaultUrl = catalogDefaultUrl || "https://mcp.example.com/mcp";
    return {
      slug,
      name: entry.name,
      category,
      supportedSchemes: ["remote_mcp", "oauth2", "bearer", "api_key"],
      defaultScheme: "remote_mcp",
      defaultEndpointUrl: defaultUrl,
      fieldsByScheme: {
        remote_mcp: [
          {
            key: "endpointUrl",
            label: "Streamable HTTP MCP Endpoint",
            placeholder: "https://connectors.example.com/mcp",
            required: true,
            defaultValue: defaultUrl
          },
          {
            key: "apiKey",
            label: "MCP Gateway Key / Bearer Token",
            placeholder: "Optional server key or access token",
            secret: true
          }
        ],
        bearer: [
          {
            key: "endpointUrl",
            label: "MCP Server URL",
            required: true,
            defaultValue: defaultUrl
          },
          {
            key: "apiKey",
            label: "Bearer Access Token",
            secret: true,
            required: true
          }
        ],
        api_key: [
          {
            key: "endpointUrl",
            label: "MCP Server URL",
            required: true,
            defaultValue: defaultUrl
          },
          {
            key: "apiKey",
            label: "API Key",
            secret: true,
            required: true
          },
          {
            key: "headerName",
            label: "Header Name",
            defaultValue: "x-api-key"
          }
        ]
      },
      notes: "Discovers and calls live tools directly via MCP Streamable HTTP / SSE."
    };
  }

  if (entry.transport === "utcp_http") {
    const defaultUrl = catalogDefaultUrl || "https://api.example.com/openapi.json";
    return {
      slug,
      name: entry.name,
      category,
      supportedSchemes: ["openapi", "bearer", "api_key", "basic"],
      defaultScheme: "openapi",
      defaultEndpointUrl: defaultUrl,
      fieldsByScheme: {
        openapi: [
          {
            key: "endpointUrl",
            label: "OpenAPI 3.x Spec or Tool Manifest JSON URL",
            placeholder: "https://api.example.com/openapi.json",
            required: true,
            defaultValue: defaultUrl
          },
          {
            key: "apiKey",
            label: "API Key / Bearer Token (optional)",
            secret: true
          },
          {
            key: "headerName",
            label: "Custom Auth Header Name (optional)",
            placeholder: "x-api-key"
          }
        ],
        bearer: [
          {
            key: "endpointUrl",
            label: "OpenAPI Spec URL",
            required: true,
            defaultValue: defaultUrl
          },
          { key: "apiKey", label: "Bearer Token", secret: true, required: true }
        ],
        api_key: [
          {
            key: "endpointUrl",
            label: "OpenAPI Spec URL",
            required: true,
            defaultValue: defaultUrl
          },
          { key: "apiKey", label: "API Key", secret: true, required: true },
          { key: "headerName", label: "Header Name", defaultValue: "x-api-key" }
        ],
        basic: [
          {
            key: "endpointUrl",
            label: "OpenAPI Spec URL",
            required: true,
            defaultValue: defaultUrl
          },
          { key: "username", label: "Username", required: true },
          { key: "password", label: "Password", secret: true, required: true }
        ]
      },
      notes: "Parses paths & schemas into callable tools executed with vault-injected credentials."
    };
  }

  if (slug === "modbus-tcp" || slug === "mqtt-broker" || slug === "opc-ua") {
    const fields: ConnectorAuthField[] =
      slug === "modbus-tcp"
        ? [
            {
              key: "endpointUrl",
              label: "Modbus TCP Endpoint (modbus://host:port)",
              defaultValue: catalogDefaultUrl || "modbus://gateway.example.com:502",
              required: true
            },
            { key: "unitId", label: "Modbus Unit ID", defaultValue: "1" },
            { key: "apiKey", label: "Gateway Auth Token (optional)", secret: true }
          ]
        : slug === "mqtt-broker"
          ? [
              {
                key: "endpointUrl",
                label: "Broker URI (mqtt:// or mqtts://)",
                defaultValue: catalogDefaultUrl || "mqtts://broker.example.com:8883",
                required: true
              },
              { key: "username", label: "Broker Username" },
              { key: "password", label: "Broker Password / Token", secret: true }
            ]
          : [
              {
                key: "endpointUrl",
                label: "OPC-UA Endpoint (opc.tcp://)",
                defaultValue: catalogDefaultUrl || "opc.tcp://plc.example.com:4840",
                required: true
              },
              { key: "apiKey", label: "Client Certificate Thumbprint / Secret", secret: true }
            ];

    return {
      slug,
      name: entry.name,
      category,
      supportedSchemes: ["protocol"],
      defaultScheme: "protocol",
      defaultEndpointUrl: fields[0]?.defaultValue ?? catalogDefaultUrl,
      fieldsByScheme: { protocol: fields },
      notes:
        slug === "modbus-tcp"
          ? "Connects over live binary Modbus TCP MBAP frames."
          : slug === "mqtt-broker"
            ? "Connects over live binary MQTT 3.1.1 wire protocol."
            : "Connects to OPC-UA industrial endpoints."
    };
  }

  const oauthProvider = OAUTH_PROVIDERS[slug];
  const restHint = API_KEY_REST_URLS[slug];
  const rawEndpoint =
    oauthProvider?.apiBaseUrl ||
    restHint?.url ||
    (catalogDefaultUrl.startsWith("https://") ? catalogDefaultUrl : "");

  if (oauthProvider) {
    return {
      slug,
      name: entry.name,
      category,
      supportedSchemes: ["oauth2", "bearer", "api_key"],
      defaultScheme: "oauth2",
      defaultEndpointUrl: rawEndpoint,
      oauthProvider,
      fieldsByScheme: {
        bearer: [
          {
            key: "endpointUrl",
            label: "API Base URL",
            defaultValue: rawEndpoint,
            required: true
          },
          {
            key: "apiKey",
            label: "Personal Access / Bearer Token",
            placeholder: "Paste token from provider settings",
            secret: true,
            required: true
          }
        ],
        api_key: [
          {
            key: "endpointUrl",
            label: "API Base URL",
            defaultValue: rawEndpoint,
            required: true
          },
          {
            key: "apiKey",
            label: "API Key",
            secret: true,
            required: true
          },
          {
            key: "headerName",
            label: "Header Name",
            defaultValue: restHint?.headerName ?? "Authorization"
          }
        ]
      },
      notes: "Connect via OAuth 2.0 + PKCE consent flow or paste an existing access token."
    };
  }

  const basicRecommended =
    slug === "jira" || slug === "servicenow" || slug.startsWith("sap-");

  return {
    slug,
    name: entry.name,
    category,
    supportedSchemes: basicRecommended
      ? ["basic", "bearer", "api_key", "openapi", "remote_mcp"]
      : ["api_key", "bearer", "basic", "oauth2", "openapi", "remote_mcp"],
    defaultScheme: basicRecommended ? "basic" : "api_key",
    defaultEndpointUrl: rawEndpoint || "https://api.example.com",
    fieldsByScheme: {
      api_key: [
        {
          key: "endpointUrl",
          label: "API Base URL",
          defaultValue: rawEndpoint || "https://api.example.com",
          required: true
        },
        {
          key: "apiKey",
          label: "API Key",
          placeholder: "Secret API key",
          secret: true,
          required: true
        },
        {
          key: "headerName",
          label: "Auth Header Name",
          defaultValue: restHint?.headerName ?? "x-api-key"
        }
      ],
      bearer: [
        {
          key: "endpointUrl",
          label: "API Base URL",
          defaultValue: rawEndpoint || "https://api.example.com",
          required: true
        },
        {
          key: "apiKey",
          label: "Bearer Token",
          secret: true,
          required: true
        }
      ],
      basic: [
        {
          key: "endpointUrl",
          label: "Instance API URL",
          defaultValue: rawEndpoint || "https://api.example.com",
          required: true
        },
        {
          key: "username",
          label: "Username / Service Email",
          required: true
        },
        {
          key: "password",
          label: "Password / API Token",
          secret: true,
          required: true
        }
      ],
      openapi: [
        {
          key: "endpointUrl",
          label: "OpenAPI 3.x Spec URL",
          placeholder: "https://api.example.com/openapi.json",
          defaultValue: "",
          required: true
        },
        {
          key: "apiKey",
          label: "API Key / Bearer Token (optional)",
          secret: true
        }
      ],
      remote_mcp: [
        {
          key: "endpointUrl",
          label: "MCP Server URL",
          placeholder: "https://mcp.example.com/mcp",
          required: true
        },
        {
          key: "apiKey",
          label: "Bearer Token / API Key (optional)",
          secret: true
        }
      ]
    },
    notes: "Credentials are encrypted with AES-256-GCM and injected server-side per request."
  };
}
