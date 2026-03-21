import { ShieldCheck } from 'lucide-react';

export function SharedFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-900">ClassroomPath</span>
            <span className="text-slate-300">·</span>
            <span className="text-sm text-slate-500">Servicio gestionado sobre</span>
            <a
              href="https://github.com/balejosg/openpath"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-sky-700 transition hover:text-sky-600"
            >
              OpenPath ↗
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <a href="/legal" className="transition hover:text-slate-900">
              Aviso Legal
            </a>
            <a href="/privacidad" className="transition hover:text-slate-900">
              Política de Privacidad
            </a>
            <a href="mailto:hola@classroompath.com" className="transition hover:text-slate-900">
              hola@classroompath.com
            </a>
            <span>© {new Date().getFullYear()} ClassroomPath</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
