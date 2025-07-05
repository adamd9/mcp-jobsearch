import nodemailer from "nodemailer";

export async function sendDigest(to, matches) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const html = `<ul>${matches.map(m => `<li><a href="${m.link}">${m.title}</a></li>`).join("")}</ul>`;
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: `Job matches ${new Date().toLocaleDateString()}`,
    html
  });
}
