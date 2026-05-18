export type ClassroomPathTestLocale = 'en' | 'es';

export function setClassroomPathTestLocale(locale: ClassroomPathTestLocale): void {
  document.documentElement.dataset.classroompathLocale = locale;
}

export function clearClassroomPathTestLocale(): void {
  delete document.documentElement.dataset.classroompathLocale;
}
