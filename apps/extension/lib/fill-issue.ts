export function fillIssueInputs(doc: Document, payload: { title: string; body: string }): boolean {
  const title = doc.querySelector<HTMLInputElement>(
    'input[name="issue[title]"],#issue_title,input[aria-label="Title"]',
  );
  const body = doc.querySelector<HTMLTextAreaElement>(
    'textarea[name="issue[body]"],#issue_body,textarea[aria-label="Add a description"]',
  );
  const view = doc.defaultView;
  if (!title || !body || !view) return false;
  for (const [element, value, prototype] of [
    [title, payload.title, view.HTMLInputElement.prototype],
    [body, payload.body, view.HTMLTextAreaElement.prototype],
  ] as const) {
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(element, value);
    element.dispatchEvent(new view.Event('input', { bubbles: true }));
    element.dispatchEvent(new view.Event('change', { bubbles: true }));
  }
  return true;
}
