import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────
// DEBUG
// ─────────────────────────────────────────────

console.log(
  "MAIL USER:",
  process.env.GMAIL_USER
);

console.log(
  "MAIL PASS:",
  process.env.GMAIL_APP_PASSWORD
);

// ─────────────────────────────────────────────
// TRANSPORTER GMAIL
// ─────────────────────────────────────────────

const transporter =
  nodemailer.createTransport({

    host: "smtp.gmail.com",

    port: 587,

    secure: false,

    auth: {

      user:
        process.env.GMAIL_USER,

      pass:
        process.env.GMAIL_APP_PASSWORD,
    },
  });

// ─────────────────────────────────────────────
// ENVOI EMAIL
// ─────────────────────────────────────────────

async function sendEmail({
  to,
  subject,
  html,
}) {

  try {

    const info =
      await transporter.sendMail({

        from:
          `"Fake News Detector" <${process.env.GMAIL_USER}>`,

        to,

        subject,

        html,
      });

    console.log(
      "[Mailer] ✅ Email envoyé:",
      info.messageId
    );

    return info;

  } catch (error) {

    console.error(
      "[Mailer] ❌ Erreur email:",
      error
    );

    throw error;
  }
}

export default {
  sendEmail,
};