# 🔍 Fake News Detector

Système multi-agents de vérification d'informations. Le workflow enchaîne :

1. Analyse de l'affirmation
2. Recherche de preuves multi-sources
3. Jugement final et recommandation

Réalisé par : **Hiba KAAOUACH** & **Oumaima BOUMAZOUED**  
Encadré par : **Dr. Hasnaa CHAABI** — EMSI 2025-2026

---

## ✅ Fonctionnalités

- Pipeline multi-agents (Analyseur → Chercheur → Juge)
- Recherche Qdrant + NewsAPI + SerpAPI
- Verdict avec score de fiabilité, arguments et sources citées
- Envoi de rapport par email (optionnel)

---

## 📁 Structure du projet

```
fake-news-detector/
├── server/                        ← Backend Node.js
│   ├── index.js                   ← Serveur Express + pipeline principal
│   ├── .env                       ← Clés API (à remplir)
│   ├── package.json
│   ├── agents/
│   │   ├── agent1_analyseur.js    ← Agent 1 : décompose l'affirmation
│   │   ├── agent2_chercheur.js    ← Agent 2 : cherche les preuves
│   │   └── agent3_juge.js         ← Agent 3 : verdict final
│   └── services/
│       ├── mailer.js              ← Envoi d'emails (Gmail)
│       └── sheets.js              ← (non utilisé actuellement)
│
└── client/                        ← Frontend React
    ├── package.json
    ├── public/
    │   └── index.html
    └── src/
        ├── App.js                 ← Composant principal
        ├── App.css                ← Styles
        ├── index.js               ← Point d'entrée React
        └── components/
            ├── Header.js
            ├── VerifyForm.js
            ├── StepTracker.js
            └── ResultCard.js
```

---

## ⚙️ Configuration des clés API

Ouvre `server/.env` et ajoute :

```
GEMINI_API_KEY=...
NEWSAPI_KEY=...
SERPAPI_KEY=...
GMAIL_USER=...
GMAIL_APP_PASSWORD=...
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=fake_news_detector
PORT=3001
```

Notes :

- `GMAIL_USER` + `GMAIL_APP_PASSWORD` sont requis seulement si tu veux recevoir l'email.
- Qdrant est optionnel, mais recommandé pour de meilleurs résultats.

---

## 🐳 Lancer Qdrant (optionnel)

```bash
docker run -d -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant
```

Dashboard : http://localhost:6333/dashboard

---

## 🖥️ Lancer le serveur

```bash
cd server
npm install
npm run dev
```

Le serveur tourne sur : http://localhost:3001

---

## ⚛️ Lancer l'interface React

```bash
cd client
npm install
npm start
```

L'interface s'ouvre sur : http://localhost:3000

---

## 🧪 Tester l'API

### Requête POST /verify

```bash
curl -X POST http://localhost:3001/verify \
  -H "Content-Type: application/json" \
  -d '{"affirmation": "Les vaccins causent l autisme", "email": "ton@email.com"}'
```

Réponse (exemple) :

```json
{
  "affirmation": "Les vaccins causent l autisme",
  "verdict": "FAUX",
  "score_fiabilite": 90,
  "arguments_pour": [],
  "arguments_contre": ["..."],
  "biais_detectes": [],
  "sources_citees": ["https://..."],
  "recommandation": "..."
}
```

---

## ✅ Logs utiles

Le serveur affiche les étapes du pipeline :

```
[PIPELINE] Agent 1 OK
[PIPELINE] Agent 2 OK
[PIPELINE] Agent 3 OK
```

---

## ❗ Problèmes fréquents

| Problème                    | Solution                                                    |
| --------------------------- | ----------------------------------------------------------- |
| `CORS error`                | Vérifier que le client appelle bien `http://localhost:3001` |
| `Gemini 403`                | Vérifier la clé `GEMINI_API_KEY`                            |
| `Qdrant connection refused` | Lancer Docker : `docker run -p 6333:6333 qdrant/qdrant`     |
| `Email not sent`            | Utiliser un App Password Gmail, pas le mot de passe normal  |
| `JSON parse error`          | Les agents réessaient automatiquement                       |
