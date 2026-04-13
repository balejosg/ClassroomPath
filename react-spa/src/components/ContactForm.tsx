import React from 'react';
import { Send, CheckCircle } from 'lucide-react';

type FormState = 'idle' | 'sending' | 'sent' | 'error';
type ContactIntent = 'Presupuesto' | 'Activación remota' | 'Demo';
type DeploymentPartnerNeed = 'No' | 'Sí' | 'No lo sé';

export function ContactForm() {
  const [state, setState] = React.useState<FormState>('idle');
  const [name, setName] = React.useState('');
  const [center, setCenter] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [classrooms, setClassrooms] = React.useState('');
  const [technicalOwner, setTechnicalOwner] = React.useState('');
  const [intent, setIntent] = React.useState<ContactIntent>('Presupuesto');
  const [deploymentPartnerNeed, setDeploymentPartnerNeed] =
    React.useState<DeploymentPartnerNeed>('No');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');

    // Build mailto as fallback (in production this should hit an API endpoint)
    const subject = encodeURIComponent('Solicitud ClassroomPath');
    const body = encodeURIComponent(
      `Qué necesitas: ${intent}\nNombre: ${name}\nCentro: ${center}\nEmail: ${email}\nNº de aulas (aprox.): ${classrooms || 'No indicado'}\nResponsable técnico: ${technicalOwner || 'No indicado'}\n¿Necesita partner de implantación?: ${deploymentPartnerNeed}`
    );
    const mailtoUrl = `mailto:hola@classroompath.com?subject=${subject}&body=${body}`;

    // Brief delay so the user sees the sending state
    setTimeout(() => {
      window.open(mailtoUrl, '_self');
      setState('sent');
    }, 400);
  };

  if (state === 'sent') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-8 py-12 text-center">
        <CheckCircle size={48} className="mx-auto text-emerald-600" />
        <h3 className="mt-4 text-xl font-semibold text-slate-900">¡Solicitud enviada!</h3>
        <p className="mt-2 text-sm text-slate-600">Te responderemos en 48 h.</p>
        <button
          type="button"
          onClick={() => setState('idle')}
          className="mt-6 text-sm font-medium text-sky-700 transition hover:text-sky-600"
        >
          Enviar otra solicitud
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className="block text-sm font-medium text-slate-700">
            Nombre
          </label>
          <input
            id="contact-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder="Tu nombre"
          />
        </div>
        <div>
          <label htmlFor="contact-center" className="block text-sm font-medium text-slate-700">
            Centro educativo
          </label>
          <input
            id="contact-center"
            type="text"
            required
            value={center}
            onChange={(e) => setCenter(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder="Nombre del centro"
          />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium text-slate-700">
            Email de contacto
          </label>
          <input
            id="contact-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder="email@centro.es"
          />
        </div>
        <div>
          <label htmlFor="contact-classrooms" className="block text-sm font-medium text-slate-700">
            Nº de aulas (opcional)
          </label>
          <input
            id="contact-classrooms"
            type="number"
            min="1"
            value={classrooms}
            onChange={(e) => setClassrooms(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder="12"
          />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor="contact-technical-owner"
            className="block text-sm font-medium text-slate-700"
          >
            Responsable técnico (opcional)
          </label>
          <input
            id="contact-technical-owner"
            type="text"
            value={technicalOwner}
            onChange={(e) => setTechnicalOwner(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder="Nombre del responsable IT"
          />
        </div>
        <div>
          <label
            htmlFor="contact-deployment-partner"
            className="block text-sm font-medium text-slate-700"
          >
            ¿Necesitáis partner de implantación?
          </label>
          <select
            id="contact-deployment-partner"
            value={deploymentPartnerNeed}
            onChange={(e) => setDeploymentPartnerNeed(e.target.value as DeploymentPartnerNeed)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          >
            <option value="No">No</option>
            <option value="Sí">Sí</option>
            <option value="No lo sé">No lo sé</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="contact-intent" className="block text-sm font-medium text-slate-700">
          Qué necesitas
        </label>
        <select
          id="contact-intent"
          value={intent}
          onChange={(e) => setIntent(e.target.value as ContactIntent)}
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
        >
          <option value="Presupuesto">Presupuesto</option>
          <option value="Activación remota">Activación remota</option>
          <option value="Demo">Demo</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={state === 'sending'}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/25 transition hover:bg-sky-500 disabled:opacity-60"
      >
        {state === 'sending' ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Enviando…
          </>
        ) : (
          <>
            <Send size={16} />
            Enviar solicitud
          </>
        )}
      </button>
    </form>
  );
}
