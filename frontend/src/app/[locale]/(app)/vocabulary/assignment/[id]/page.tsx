import { VocabularyAssignment } from "@/components/vocabulary/VocabularyAssignment";

export default async function VocabularyAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VocabularyAssignment assignmentId={id} />;
}
