import { CodeChangeEditor } from '../../../../../components/code-change-editor';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CodeChangeEditor key={id} jobId={id} />;
}
