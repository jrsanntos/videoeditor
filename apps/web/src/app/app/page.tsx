import { redirect } from "next/navigation";
import { Editor } from "@/components/Editor";
import { currentUser } from "@/server/users";

export const dynamic = "force-dynamic";

export const metadata = { title: "Editor — videoeditor" };

export default async function AppPage() {
  if (!(await currentUser())) redirect("/login");
  return <Editor />;
}
