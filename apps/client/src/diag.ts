// Ladebericht für die Menüzeile: zeigt, ob Texturen/Modelle wirklich geladen wurden oder die
// einfachen Ersatzformen laufen (sonst von außen nicht zu unterscheiden).
export const diag = { models: '', textures: '', figure: '', gpu: '', errors: [] as string[] };

export function diagLine(profile: string) {
  const e = diag.errors.length ? ` · Fehler: ${diag.errors.slice(0, 2).join(' | ')}` : '';
  return `Grafik ${profile} · Modelle ${diag.models} · Texturen ${diag.textures} · Figur ${diag.figure} · GPU ${diag.gpu}${e}`;
}

export function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0, 60) : 'unbekannt';
  } catch {
    return 'unbekannt';
  }
}
