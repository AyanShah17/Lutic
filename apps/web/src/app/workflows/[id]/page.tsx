import { WorkflowCanvas } from "@/components/workflow-canvas";

export default async function WorkflowDetailPage({
  params: pendingParams
}: {
  params: Promise<{ id: string }>;
}) {
  const params = await pendingParams;
  return <WorkflowCanvas workflowId={params.id} />;
}
