export type FormField = {
  id: string;
  type: 'markdown' | 'input' | 'textarea' | 'dropdown' | 'checkboxes';
  label: string;
  description?: string;
  value?: string;
  placeholder?: string;
  required: boolean;
  multiple?: boolean;
  options: { label: string; required?: boolean }[];
};
export type IssueTemplate = {
  id: string;
  name: string;
  about: string;
  title?: string;
  labels: string[];
  kind: 'markdown' | 'form';
  body?: string;
  fields?: FormField[];
};
export type FormAnswers = Record<string, string | string[]>;
import { parse } from 'yaml';
import { AppError } from '@openself/shared/errors';
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : [];
}
export function parseTemplate(id: string, text: string): IssueTemplate | null {
  if (/(^|\/)config\.ya?ml$/i.test(id)) return null;
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  const isMd = /\.md$/i.test(id);
  if (isMd && !front) return null;
  const meta = object(parse(isMd ? front![1]! : text, { maxAliasCount: 20 }));
  if (typeof meta.name !== 'string') throw new AppError('invalid_template');
  const result: IssueTemplate = {
    id,
    name: meta.name,
    about: String(meta.about ?? meta.description ?? ''),
    title: typeof meta.title === 'string' ? meta.title : undefined,
    labels: strings(meta.labels),
    kind: isMd ? 'markdown' : 'form',
  };
  if (isMd) return { ...result, body: text.slice(front![0].length).replace(/\r\n/g, '\n') };
  if (!Array.isArray(meta.body)) throw new AppError('invalid_template');
  result.fields = meta.body.map((item, index) => {
    const field = object(item),
      attr = object(field.attributes),
      validation = object(field.validations);
    if (!['markdown', 'input', 'textarea', 'dropdown', 'checkboxes'].includes(String(field.type)))
      throw new AppError('unsupported_template');
    const options = Array.isArray(attr.options)
      ? attr.options.map((option) =>
          typeof option === 'string'
            ? { label: option }
            : {
                label: String(object(option).label ?? ''),
                required: object(option).required === true,
              },
        )
      : [];
    return {
      id: String(field.id ?? `field-${index}`),
      type: field.type as FormField['type'],
      label: String(attr.label ?? ''),
      description: typeof attr.description === 'string' ? attr.description : undefined,
      value: typeof attr.value === 'string' ? attr.value : undefined,
      placeholder: typeof attr.placeholder === 'string' ? attr.placeholder : undefined,
      required: validation.required === true,
      multiple: attr.multiple === true,
      options,
    };
  });
  if (new Set(result.fields.map((f) => f.id)).size !== result.fields.length)
    throw new AppError('invalid_template');
  return result;
}
export function parseTemplateConfig(text: string) {
  return {
    blankIssuesEnabled: object(parse(text, { maxAliasCount: 20 })).blank_issues_enabled !== false,
  };
}
export function buildFormBody(template: IssueTemplate, answers: FormAnswers): string {
  return (
    (template.fields ?? [])
      .filter((field) => field.type !== 'markdown')
      .map((field) => {
        const answer = answers[field.id] ?? field.value ?? '';
        const values = Array.isArray(answer) ? answer : answer.trim() ? [answer.trim()] : [];
        if (field.required && !values.length) throw new AppError('required_fields');
        if (field.type === 'dropdown' || field.type === 'checkboxes') {
          if (
            values.some((v) => !field.options.some((o) => o.label === v)) ||
            (field.type === 'dropdown' && !field.multiple && values.length > 1)
          )
            throw new AppError('invalid_form_answer');
          if (field.options.some((o) => o.required && !values.includes(o.label)))
            throw new AppError('required_fields');
        }
        const value =
          field.type === 'checkboxes'
            ? field.options
                .map((o) => `- [${values.includes(o.label) ? 'x' : ' '}] ${o.label}`)
                .join('\n')
            : values.join(', ') || '_No response_';
        return `### ${field.label}\n\n${value}`;
      })
      .join('\n\n') + '\n'
  );
}
