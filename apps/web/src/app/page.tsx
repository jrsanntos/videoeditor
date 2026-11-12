import { redirect } from "next/navigation";
import { Editor } from "@/components/Editor";
import { currentUser } from "@/server/users";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await currentUser())) redirect("/login");
  return <Editor />;
}
