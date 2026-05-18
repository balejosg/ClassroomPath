import { Building2, Layers, Rocket, School, Target, Unlock, Users } from 'lucide-react';

import { translateClassroomPathText, type ClassroomPathT } from '../../i18n/classroompath-i18n';

export function getQuickBenefits(t: ClassroomPathT) {
  return [
    {
      title: t('landing.benefit.price.title'),
      text: t('landing.benefit.price.text'),
    },
    {
      title: t('landing.benefit.activation.title'),
      text: t('landing.benefit.activation.text'),
    },
    {
      title: t('landing.benefit.open.title'),
      text: t('landing.benefit.open.text'),
    },
  ];
}

const englishT: ClassroomPathT = (key, params) => translateClassroomPathText('en', key, params);

export const quickBenefits = getQuickBenefits(englishT);

export function getPracticalSteps(t: ClassroomPathT) {
  return [
    {
      step: t('landing.step.one'),
      title: t('landing.step.criteria.title'),
      text: t('landing.step.criteria.text'),
    },
    {
      step: t('landing.step.two'),
      title: t('landing.step.activation.title'),
      text: t('landing.step.activation.text'),
    },
    {
      step: t('landing.step.three'),
      title: t('landing.step.friction.title'),
      text: t('landing.step.friction.text'),
    },
  ];
}

export const practicalSteps = getPracticalSteps(englishT);

export function getRoleBenefits(t: ClassroomPathT) {
  return [
    {
      icon: Building2,
      title: t('landing.role.leadership.title'),
      text: t('landing.role.leadership.text'),
    },
    {
      icon: Users,
      title: t('landing.role.teachers.title'),
      text: t('landing.role.teachers.text'),
    },
    {
      icon: School,
      title: t('landing.role.it.title'),
      text: t('landing.role.it.text'),
    },
  ];
}

export const roleBenefits = getRoleBenefits(englishT);

export function getFitSignals(t: ClassroomPathT) {
  return [
    {
      icon: Target,
      title: t('landing.fitSignal.filter.title'),
      text: t('landing.fitSignal.filter.text'),
    },
    {
      icon: Layers,
      title: t('landing.fitSignal.devices.title'),
      text: t('landing.fitSignal.devices.text'),
    },
    {
      icon: Rocket,
      title: t('landing.fitSignal.deployment.title'),
      text: t('landing.fitSignal.deployment.text'),
    },
    {
      icon: Unlock,
      title: t('landing.fitSignal.open.title'),
      text: t('landing.fitSignal.open.text'),
    },
  ];
}

export const fitSignals = getFitSignals(englishT);
