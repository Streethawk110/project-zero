// Laufzeitkonfiguration: Die Datei config.json neben index.html kann auf dem
// Webserver angepasst werden, ohne das Spiel neu zu bauen.

export interface RuntimeConfig {
  serverUrl: string;
  serverName: string;
  allowOnline: boolean;
}

export const runtimeConfig: RuntimeConfig = {
  serverUrl: (import.meta.env['VITE_SERVER_URL'] as string | undefined) ?? '',
  serverName: 'Project Zero',
  allowOnline: true,
};

export async function loadRuntimeConfig() {
  try {
    const r = await fetch('./config.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const c = (await r.json()) as Partial<RuntimeConfig>;
    Object.assign(runtimeConfig, Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== '')));
  } catch {
    /* Offline oder Datei fehlt: Voreinstellungen verwenden */
  }
}
