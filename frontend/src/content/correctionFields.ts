import type { CorrectionField } from '../api';

export const correctionFieldOptions: { value: CorrectionField; label: string }[] = [
  { value: 'name', label: 'Nombre' },
  { value: 'repo_url', label: 'Repositorio' },
  { value: 'branch', label: 'Rama' },
  { value: 'purpose', label: 'Descripción' },
  { value: 'requested_subdomain', label: 'URL' },
  { value: 'course', label: 'Curso' },
];

export const courseOptions = [
  { value: '', label: 'No pertenece a ninguna clase' },
  ...['Diseño Web II', 'Ingeniería de Software', 'Bases de Datos'].map((course) => ({ value: course, label: course })),
];
