import React from 'react';
import { Send, CheckCircle } from 'lucide-react';

import { useClassroomPathT } from '../i18n/classroompath-i18n';

type FormState = 'idle' | 'sending' | 'sent' | 'error';
type ContactIntent = 'quote' | 'remoteActivation' | 'demo';
type DeploymentPartnerNeed = 'no' | 'yes' | 'notSure';

export function ContactForm() {
  const t = useClassroomPathT();
  const [state, setState] = React.useState<FormState>('idle');
  const [name, setName] = React.useState('');
  const [center, setCenter] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [classrooms, setClassrooms] = React.useState('');
  const [technicalOwner, setTechnicalOwner] = React.useState('');
  const [intent, setIntent] = React.useState<ContactIntent>('quote');
  const [deploymentPartnerNeed, setDeploymentPartnerNeed] =
    React.useState<DeploymentPartnerNeed>('no');

  const intentLabel = {
    quote: t('contact.intent.quote'),
    remoteActivation: t('contact.intent.remoteActivation'),
    demo: t('contact.intent.demo'),
  }[intent];
  const partnerNeedLabel = {
    no: t('contact.no'),
    yes: t('contact.yes'),
    notSure: t('contact.notSure'),
  }[deploymentPartnerNeed];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');

    // Build mailto as fallback (in production this should hit an API endpoint)
    const subject = encodeURIComponent(t('contact.email.subject'));
    const body = encodeURIComponent(
      t('contact.email.body', {
        center,
        classrooms: classrooms || t('contact.notProvided'),
        deploymentPartnerNeed: partnerNeedLabel,
        email,
        intent: intentLabel,
        name,
        technicalOwner: technicalOwner || t('contact.notProvided'),
      })
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
        <h3 className="mt-4 text-xl font-semibold text-slate-900">{t('contact.sent.title')}</h3>
        <p className="mt-2 text-sm text-slate-600">{t('contact.sent.body')}</p>
        <button
          type="button"
          onClick={() => setState('idle')}
          className="mt-6 text-sm font-medium text-sky-700 transition hover:text-sky-600"
        >
          {t('contact.sent.again')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className="block text-sm font-medium text-slate-700">
            {t('contact.name.label')}
          </label>
          <input
            id="contact-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder={t('contact.name.placeholder')}
          />
        </div>
        <div>
          <label htmlFor="contact-center" className="block text-sm font-medium text-slate-700">
            {t('contact.center.label')}
          </label>
          <input
            id="contact-center"
            type="text"
            required
            value={center}
            onChange={(e) => setCenter(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder={t('contact.center.placeholder')}
          />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium text-slate-700">
            {t('contact.email.label')}
          </label>
          <input
            id="contact-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder={t('contact.email.placeholder')}
          />
        </div>
        <div>
          <label htmlFor="contact-classrooms" className="block text-sm font-medium text-slate-700">
            {t('contact.classrooms.label')}
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
            {t('contact.technicalOwner.label')}
          </label>
          <input
            id="contact-technical-owner"
            type="text"
            value={technicalOwner}
            onChange={(e) => setTechnicalOwner(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder={t('contact.technicalOwner.placeholder')}
          />
        </div>
        <div>
          <label
            htmlFor="contact-deployment-partner"
            className="block text-sm font-medium text-slate-700"
          >
            {t('contact.partner.label')}
          </label>
          <select
            id="contact-deployment-partner"
            value={deploymentPartnerNeed}
            onChange={(e) => setDeploymentPartnerNeed(e.target.value as DeploymentPartnerNeed)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          >
            <option value="no">{t('contact.no')}</option>
            <option value="yes">{t('contact.yes')}</option>
            <option value="notSure">{t('contact.notSure')}</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="contact-intent" className="block text-sm font-medium text-slate-700">
          {t('contact.intent.label')}
        </label>
        <select
          id="contact-intent"
          value={intent}
          onChange={(e) => setIntent(e.target.value as ContactIntent)}
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
        >
          <option value="quote">{t('contact.intent.quote')}</option>
          <option value="remoteActivation">{t('contact.intent.remoteActivation')}</option>
          <option value="demo">{t('contact.intent.demo')}</option>
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
            {t('contact.sending')}
          </>
        ) : (
          <>
            <Send size={16} />
            {t('contact.submit')}
          </>
        )}
      </button>
    </form>
  );
}
