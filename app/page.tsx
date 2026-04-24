import { redirect } from "next/navigation";

export default function redirectToDashboard() {
  redirect("/dashboard");
}