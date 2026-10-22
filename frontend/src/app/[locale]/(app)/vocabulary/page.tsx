import { setRequestLocale } from "next-intl/server";
import { getSessionRole } from "@/lib/auth";
import { VocabularyCatalogView } from "@/components/vocabulary/VocabularyCatalogView";

export default async function VocabularyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const role = (await getSessionRole()) || "student";

  return <VocabularyCatalogView userRole={role} />;
}
