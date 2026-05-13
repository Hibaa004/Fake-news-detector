import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";

import agentAnalyseur from "./agents/agent1_analyseur.js";
import agentChercheur from "./agents/agent2_chercheur.js";
import agentJuge from "./agents/agent3_juge.js";
import mailer from "./services/mailer.js";

// ─────────────────────────────────────────────
// DEBUG ENV
// ─────────────────────────────────────────────

console.log("EMAIL:", process.env.GMAIL_USER);
console.log(
  "PASSWORD EXISTS:",
  !!process.env.GMAIL_APP_PASSWORD
);

// ─────────────────────────────────────────────
// EXPRESS
// ─────────────────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// Gemini
// ─────────────────────────────────────────────

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ─────────────────────────────────────────────
// Qdrant
// ─────────────────────────────────────────────

const QDRANT_URL =
  process.env.QDRANT_URL ||
  "http://localhost:6333";

const COLLECTION =
  process.env.QDRANT_COLLECTION ||
  "fake_news_detector";

// ─────────────────────────────────────────────
// Embedding
// ─────────────────────────────────────────────

async function embedTexte(text) {

  const response =
    await ai.models.embedContent({

      model: "gemini-embedding-001",

      contents: text,
    });

  return response.embeddings[0].values;
}

// ─────────────────────────────────────────────
// ROUTE VERIFY
// ─────────────────────────────────────────────

app.post("/verify", async (req, res) => {

  try {

    const {
      affirmation,
      email,
    } = req.body;

    console.log(
      "\n==================================="
    );

    console.log(
      "AFFIRMATION:",
      affirmation
    );

    console.log(
      "EMAIL:",
      email
    );

    // ─────────────────────────────
    // AGENT 1
    // ─────────────────────────────

    const analyse =
      await agentAnalyseur.analyser(
        affirmation
      );

    console.log(
      "[PIPELINE] Agent 1 OK"
    );

    // ─────────────────────────────
    // AGENT 2
    // ─────────────────────────────

    const preuves =
      await agentChercheur
        .chercher(analyse);

    console.log(
      "[PIPELINE] Agent 2 OK"
    );

    // ─────────────────────────────
    // AGENT 3
    // ─────────────────────────────

    const resultat =
      await agentJuge
        .juger(preuves);

    console.log(
      "[PIPELINE] Agent 3 OK"
    );

    console.log(
      "\n===== RESULTAT ENVOYÉ FRONT ====="
    );

    console.log(
      JSON.stringify(
        resultat,
        null,
        2
      )
    );

    // ─────────────────────────────
    // ENVOI EMAIL
    // ─────────────────────────────

    if (email) {

      try {

        await mailer.sendEmail({

          to: email,

          subject:
            `Résultat Fake News Detector : ${resultat.verdict}`,

          html: `
            <div style="font-family: Arial; padding: 20px;">

              <h2>
                🔎 Résultat de vérification
              </h2>

              <p>
                <strong>Affirmation :</strong>
                ${resultat.affirmation}
              </p>

              <p>
                <strong>Verdict :</strong>
                ${resultat.verdict}
              </p>

              <p>
                <strong>Score fiabilité :</strong>
                ${resultat.score_fiabilite}%
              </p>

              <h3>
                📚 Sources utilisées
              </h3>

              <ul>
                ${resultat.sources_citees
                  .map(
                    source => `
                      <li>
                        <a href="${source}">
                          ${source}
                        </a>
                      </li>
                    `
                  )
                  .join("")}
              </ul>

              <p>
                ${resultat.recommandation}
              </p>

              <hr />

              <p style="color: gray;">
                Fake News Detector —
                EMSI 2024-2025
              </p>

            </div>
          `,
        });

        console.log(
          "[EMAIL] ✅ envoyé avec succès"
        );

      } catch (mailError) {

        console.error(
          "[EMAIL ERROR]",
          mailError
        );
      }
    }

    // ─────────────────────────────
    // RESPONSE FRONT
    // ─────────────────────────────

    return res.json(resultat);

  } catch (error) {

    console.error(
      "[SERVER ERROR]",
      error
    );

    return res.status(500).json({

      erreur:
        error.message ||
        "Erreur serveur",
    });
  }
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

const PORT =
  process.env.PORT || 3001;

app.listen(PORT, () => {

  console.log(
    `✅ Serveur démarré sur http://localhost:${PORT}`
  );
});