import { standIn } from "./prints";

export const PHOTO_ACCESS = "https://localhost:4341";

export async function photoCodeMail(email: string) {
  const mail = await standIn<{ to: string; subject: string; text: string }[]>("/__mail");
  return mail.filter((message) => message.to.toLowerCase() === email.toLowerCase() && message.subject === "your photo download sign-in code");
}
