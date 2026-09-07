/**
 * The connector catalogue.
 *
 * This file is configuration. Adding a provider is an entry here plus two
 * environment variables — never a schema change and never a new component. If
 * a provider ever needs its own UI, that is the signal this abstraction has
 * leaked, in the same way a tenth renderer would be.
 *
 * Scopes are the minimum each capability needs, and read-only wherever the
 * provider offers a read-only scope.
 */

/**
 * How a provider is authenticated. OAuth is a grant the user gives in a popup;
 * an API key is a value they paste. Both end up as one encrypted row in
 * `connections`, which is why adding the second kind needed no migration.
 */
export type CredentialKind = "oauth2" | "api_key";

/** One value an api_key provider needs, as the credential form asks for it. */
export interface CredentialField {
  key: string;
  label: string;
  /** Masked in the form and never returned to the browser afterwards. */
  secret?: boolean;
  help?: string;
}

export interface ProviderConfig {
  key: string;
  label: string;
  /** One line, in the user's terms, about what connecting enables. */
  blurb: string;
  /** Defaults to oauth2. */
  kind?: CredentialKind;

  /* OAuth2 ---------------------------------------------------------------- */
  authorizeUrl?: string;
  tokenUrl?: string;
  /** Absent where the provider has no revocation endpoint. */
  revokeUrl?: string;
  scopes?: string[];
  /** Extra parameters the provider needs on the authorize call. */
  authorizeParams?: Record<string, string>;
  /** Environment variables holding the client credentials. */
  clientIdEnv?: string;
  clientSecretEnv?: string;
  /** Where to read the account's identity once a token exists. */
  identity?: {
    url: string;
    /** Picks {id, label} out of the identity response. */
    read: (body: Record<string, unknown>) => { id: string; label: string };
  };

  /* API key --------------------------------------------------------------- */
  /** What the credential form asks for. api_key providers only. */
  credentialFields?: CredentialField[];
  /** Which field identifies the account, and which one labels it. */
  accountIdField?: string;
  accountLabelField?: string;

  /* Outbound calls -------------------------------------------------------- */
  /** Prefix for relative paths passed to callProvider. */
  apiBase?: string;
  /** Headers built from an api_key provider's stored values. */
  authHeaders?: (values: Record<string, string>) => Record<string, string>;
  /**
   * Some providers answer 200 and put the failure in the body — Slack's
   * `{ ok: false, error }` is the classic. Returning a message here turns that
   * into a failed run rather than a silent no-op.
   */
  checkResponse?: (body: unknown) => string | undefined;
}

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Google hands back a refresh token only when asked, and only once. */
const GOOGLE_PARAMS = { access_type: "offline", prompt: "consent" };

function googleIdentity(body: Record<string, unknown>): { id: string; label: string } {
  const id = String(body.id ?? "");
  const email = String(body.email ?? "");
  return { id: id || email, label: email || id };
}

export const PROVIDERS: ProviderConfig[] = [
  {
    key: "gmail",
    label: "Gmail",
    blurb: "Match email to contacts and companies, and show it on the timeline.",
    authorizeUrl: GOOGLE_AUTHORIZE,
    tokenUrl: GOOGLE_TOKEN,
    revokeUrl: GOOGLE_REVOKE,
    // gmail.send is needed by the send_email automation action; without it
    // lib/email/send.ts fails at runtime against a readonly token.
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "email",
      "profile",
    ],
    authorizeParams: GOOGLE_PARAMS,
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    identity: { url: GOOGLE_USERINFO, read: googleIdentity },
  },
  {
    key: "google_drive",
    label: "Google Drive",
    // metadata.readonly reads names and ownership, never file contents.
    blurb: "Attach documents to records without copying their contents.",
    authorizeUrl: GOOGLE_AUTHORIZE,
    tokenUrl: GOOGLE_TOKEN,
    revokeUrl: GOOGLE_REVOKE,
    scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly", "email", "profile"],
    authorizeParams: GOOGLE_PARAMS,
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    identity: { url: GOOGLE_USERINFO, read: googleIdentity },
  },
  {
    key: "slack",
    label: "Slack",
    blurb: "Post record updates into a channel.",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    revokeUrl: "https://slack.com/api/auth.revoke",
    scopes: ["channels:read", "chat:write"],
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
    apiBase: "https://slack.com/api",
    // Slack answers 200 for a refused post and puts the reason in the body.
    checkResponse: (body) => {
      const answer = body as { ok?: boolean; error?: string };
      return answer?.ok === false ? (answer.error ?? "Slack refused that message.") : undefined;
    },
    identity: {
      url: "https://slack.com/api/auth.test",
      read: (body) => ({
        id: String(body.team_id ?? body.user_id ?? ""),
        label: String(body.team ?? body.user ?? "Slack"),
      }),
    },
  },
  {
    key: "outlook",
    label: "Outlook",
    blurb: "Match email to contacts and companies, and show it on the timeline.",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "https://graph.microsoft.com/Mail.Read", "User.Read"],
    clientIdEnv: "OUTLOOK_CLIENT_ID",
    clientSecretEnv: "OUTLOOK_CLIENT_SECRET",
    identity: {
      url: "https://graph.microsoft.com/v1.0/me",
      read: (body) => ({
        id: String(body.id ?? ""),
        label: String(body.mail ?? body.userPrincipalName ?? "Outlook"),
      }),
    },
  },
  {
    key: "hubspot",
    label: "HubSpot",
    blurb: "Read an existing HubSpot portal to compare or migrate.",
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
    clientIdEnv: "HUBSPOT_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_CLIENT_SECRET",
    identity: {
      url: "https://api.hubapi.com/oauth/v1/access-tokens",
      read: (body) => ({
        id: String(body.hub_id ?? ""),
        label: String(body.hub_domain ?? body.user ?? "HubSpot"),
      }),
    },
  },
  {
    key: "calendly",
    label: "Calendly",
    blurb: "Log booked meetings against the right contact.",
    authorizeUrl: "https://auth.calendly.com/oauth/authorize",
    tokenUrl: "https://auth.calendly.com/oauth/token",
    revokeUrl: "https://auth.calendly.com/oauth/revoke",
    scopes: ["default"],
    clientIdEnv: "CALENDLY_CLIENT_ID",
    clientSecretEnv: "CALENDLY_CLIENT_SECRET",
    identity: {
      url: "https://api.calendly.com/users/me",
      read: (body) => {
        const resource = (body.resource ?? {}) as Record<string, unknown>;
        return {
          id: String(resource.uri ?? ""),
          label: String(resource.email ?? resource.name ?? "Calendly"),
        };
      },
    },
  },
  {
    key: "notion",
    label: "Notion",
    blurb: "Link notes and briefs to records.",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    authorizeParams: { owner: "user" },
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
    identity: {
      url: "https://api.notion.com/v1/users/me",
      read: (body) => ({
        id: String(body.id ?? ""),
        label: String(body.name ?? "Notion"),
      }),
    },
  },
  {
    key: "zoom",
    label: "Zoom",
    blurb: "Log calls against the right contact.",
    authorizeUrl: "https://zoom.us/oauth/authorize",
    tokenUrl: "https://zoom.us/oauth/token",
    revokeUrl: "https://zoom.us/oauth/revoke",
    scopes: ["user:read"],
    clientIdEnv: "ZOOM_CLIENT_ID",
    clientSecretEnv: "ZOOM_CLIENT_SECRET",
    identity: {
      url: "https://api.zoom.us/v2/users/me",
      read: (body) => ({
        id: String(body.id ?? ""),
        label: String(body.email ?? "Zoom"),
      }),
    },
  },
  {
    key: "twilio",
    label: "Twilio",
    blurb: "Send text messages from a workflow.",
    kind: "api_key",
    credentialFields: [
      {
        key: "accountSid",
        label: "Account SID",
        help: "Starts with AC. Find it on the Twilio console home page.",
      },
      { key: "authToken", label: "Auth token", secret: true },
      { key: "fromNumber", label: "From number", help: "In +15551234567 form." },
    ],
    accountIdField: "accountSid",
    accountLabelField: "fromNumber",
    apiBase: "https://api.twilio.com/2010-04-01",
    authHeaders: (values) => ({
      authorization: `Basic ${Buffer.from(`${values.accountSid}:${values.authToken}`).toString("base64")}`,
    }),
  },
];

export function credentialKind(provider: ProviderConfig): CredentialKind {
  return provider.kind ?? "oauth2";
}

/** A provider with its OAuth half filled in, which the grant flow requires. */
export type OAuthProviderConfig = ProviderConfig &
  Required<Pick<ProviderConfig, "authorizeUrl" | "tokenUrl" | "scopes" | "clientIdEnv" | "clientSecretEnv" | "identity">>;

/**
 * Narrows a provider to the OAuth flow, or says plainly that it is not one.
 * The registry holds both kinds now, and the grant code should refuse an API-key
 * provider rather than build a half-formed authorize URL out of undefineds.
 */
export function asOAuth(provider: ProviderConfig): OAuthProviderConfig {
  if (
    credentialKind(provider) !== "oauth2" ||
    !provider.authorizeUrl ||
    !provider.tokenUrl ||
    !provider.clientIdEnv ||
    !provider.clientSecretEnv ||
    !provider.identity
  ) {
    throw new Error(`${provider.label} is connected with a key, not an OAuth grant.`);
  }
  return provider as OAuthProviderConfig;
}

export function providerFor(key: string): ProviderConfig | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

/**
 * A provider is only offerable where it can actually be connected. For OAuth
 * that means this deployment holds the client credentials; showing a Connect
 * button that cannot work is worse than showing none. An api_key provider needs
 * nothing from the deployment — the tenant supplies the credential — so it is
 * always offerable.
 */
export function isConfigured(provider: ProviderConfig): boolean {
  if (credentialKind(provider) === "api_key") return true;
  return Boolean(
    provider.clientIdEnv &&
      provider.clientSecretEnv &&
      process.env[provider.clientIdEnv] &&
      process.env[provider.clientSecretEnv],
  );
}
