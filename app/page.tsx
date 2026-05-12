import { CvBuilderApp } from "@/components/cv-builder-app";
import { AuthGuard } from "@/components/auth-guard";

export default function Home() {
  return (
    <AuthGuard>
      <CvBuilderApp />
    </AuthGuard>
  );
}
